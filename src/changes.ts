import type { RealtimeWeatherConfigSection } from './config.ts';
import { alertGrade, conditionCode, weatherTags, uvLevel, type Alert, type Change, type Weather } from './model.ts';
import { clock } from './time.ts';

export function precipitationRank(w: Weather): number | undefined {
  const ranks: Record<string, number> = { '305': 1, '309': 1, '314': 1.5, '315': 2.5, '316': 3.5, '317': 4.5, '318': 5.5, '308': 7, '306': 2, '307': 3, '310': 4, '311': 5, '312': 6, '400': 1, '401': 2, '402': 3, '403': 4, '408': 1.5, '409': 2.5, '410': 3.5 };
  return ranks[w.conditionCode];
}

/** 数字基线只在对应阈值触发时前移；其他字段保持最近成功状态。 */
export function weatherChanges(before: Weather, current: Weather, cfg: RealtimeWeatherConfigSection): { changes: Change[]; baseline: Weather } {
  const changes: Change[] = [];
  const baseline: Weather = { ...current };
  const add = (id: string, text: string) => changes.push({ id, text });
  const oldTags = weatherTags(before), newTags = weatherTags(current);
  if (conditionCode(before.conditionCode) !== conditionCode(current.conditionCode)) {
    const cloudRank: Record<string, number> = { '102': 1, '103': 1, '101': 2, '104': 3 };
    const oldCloud = cloudRank[conditionCode(before.conditionCode)], newCloud = cloudRank[conditionCode(current.conditionCode)];
    const id = oldCloud !== undefined && newCloud !== undefined && oldCloud !== newCloud ? newCloud > oldCloud ? 'cloudIncreased' : 'cloudDecreased' : oldTags.includes('cloudy') && newTags.includes('clear') ? 'becameClear' : oldTags.includes('clear') && newTags.includes('cloudy') ? 'becameCloudy' : 'conditionChanged';
    add(id, `${before.condition}→${current.condition}`);
  }
  const oldThunder = oldTags.includes('thunder'), newThunder = newTags.includes('thunder');
  if (!oldThunder && newThunder) add('thunderStarted', '出现雷阵雨');
  if (oldThunder && !newThunder && current.precipitationType === 'none') add('thunderStopped', '雷阵雨停止');
  if (oldThunder && ['305', '306', '309', '314'].includes(current.conditionCode)) add('thunderToRain', '雷阵雨转普通雨');
  for (const phenomenon of ['haze', 'dust'] as const) {
    if (!oldTags.includes(phenomenon) && newTags.includes(phenomenon)) add(`${phenomenon}Started`, phenomenon === 'haze' ? '出现霾' : '出现沙尘');
    if (oldTags.includes(phenomenon) && newTags.some(t => ['clear', 'cloudy'].includes(t))) add(`${phenomenon}Cleared`, phenomenon === 'haze' ? '霾消退' : '沙尘消退');
  }
  const oldType = before.precipitationType ?? 'unknown', newType = current.precipitationType ?? 'unknown';
  if (oldType !== newType) {
    if (oldType === 'none' && newType === 'mixed') add('mixedStarted', '开始下雨夹雪');
    else if (oldType === 'mixed' && newType === 'none') add('mixedStopped', '雨夹雪停止');
    else if (oldType === 'snow' && newType === 'mixed') add('snowToMixed', '雪转雨夹雪');
    else if (oldType === 'mixed' && newType === 'snow') add('mixedToSnow', '雨夹雪转雪');
    else if (oldType === 'rain' && ['snow', 'mixed'].includes(newType)) add('rainToSnow', '雨转雪或雨夹雪');
    else if (['snow', 'mixed'].includes(oldType) && newType === 'rain') add('snowToRain', '雪转雨');
    else if (newType === 'rain' || newType === 'snow') add(newType === 'rain' ? 'rainStarted' : 'snowStarted', `${newType === 'rain' ? '开始下雨' : '开始下雪'}`);
    else if (newType === 'none' && (oldType === 'rain' || oldType === 'snow')) add(oldType === 'rain' ? 'rainStopped' : 'snowStopped', oldType === 'rain' ? '雨停了' : '雪停了');
    else if (newType === 'none') add('precipitationStopped', '当前无降水');
    else add('precipitationChanged', '降水类型改变');
  } else if (['rain', 'snow'].includes(newType)) {
    // Only compare known intensity classes; shower/type codes do not imply a strength.
    const oldRank = precipitationRank(before), newRank = precipitationRank(current);
    if (oldRank !== undefined && newRank !== undefined && oldRank !== newRank) {
      const rising = newRank > oldRank;
      add(`${newType}${rising ? 'Stronger' : 'Weaker'}`, `${newType === 'rain' ? '雨势' : '雪势'}${rising ? '增强' : '减弱'}`);
    } else if (before.precipitationIntensity !== undefined && current.precipitationIntensity !== undefined) {
      const band = (value: number) => value <= 0 ? 0 : value < 2.5 ? 1 : value < 8 ? 2 : 3;
      if (band(before.precipitationIntensity) !== band(current.precipitationIntensity)) {
        const rising = current.precipitationIntensity > before.precipitationIntensity;
        add(`${newType}${rising ? 'Stronger' : 'Weaker'}`, `${newType === 'rain' ? '雨势' : '雪势'}${rising ? '增强' : '减弱'}`);
      }
    }
  }
  for (const [key, threshold, unit, label, up, down] of [
    ['temperature', cfg.temperatureChange, '°C', '温度', 'temperatureUp', 'temperatureDown'],
    ['feelsLike', cfg.temperatureChange, '°C', '体感', 'feelsLikeUp', 'feelsLikeDown'],
    ['windScale', cfg.windScaleChange, '级', '风力', 'windUp', 'windDown'],
    ['precipitationProbability', cfg.precipitationProbabilityChange / 100, '', '降水概率', 'probabilityUp', 'probabilityDown'],
  ] as const) {
    const previous = before[key], value = current[key];
    if (previous === undefined || value === undefined) continue;
    const delta = key === 'precipitationProbability' ? Math.abs(Math.round(value * 100) - Math.round(previous * 100)) / 100 : Math.abs(value - previous);
    if (delta >= threshold) {
      const display = (n: number) => key === 'precipitationProbability' ? `${Math.round(n * 100)}%` : `${Math.round(n * 10) / 10}${unit}`;
      add(value > previous ? up : down, `${label}${display(previous)}→${display(value)}`);
    } else baseline[key] = previous;
  }
  if (before.visibilityKm !== undefined && current.visibilityKm !== undefined && (before.visibilityKm < cfg.visibilityThresholdKm) !== (current.visibilityKm < cfg.visibilityThresholdKm)) add(current.visibilityKm < cfg.visibilityThresholdKm ? 'visibilityDown' : 'visibilityUp', `能见度${before.visibilityKm}→${current.visibilityKm} km`);
  if (before.uv !== undefined && current.uv !== undefined && uvLevel(before.uv) !== uvLevel(current.uv)) add(current.uv > before.uv ? 'uvUp' : 'uvDown', `UV ${before.uv}→${current.uv}`);
  return { changes, baseline };
}

export function activeAlerts(alerts: Alert[], now: number): Alert[] {
  const replaced = new Set(alerts.flatMap(a => a.supersedes));
  return alerts.filter(a => !replaced.has(a.id) && a.kind !== 'cancel' && (!a.expiresAt || Date.parse(a.expiresAt) > now));
}
export function alertChanges(before: Alert[], messages: Alert[], now: number, timezone = 'UTC'): Change[] {
  const changes: Change[] = [];
  const old = new Map(before.map(a => [a.id, a]));
  const replaced = new Set(messages.flatMap(a => a.supersedes));
  const severity = ['unknown', 'minor', 'moderate', 'severe', 'extreme'];
  const colors = ['white', 'green', 'blue', 'yellow', 'amber', 'orange', 'red', 'purple', 'black'];
  const messagesById = new Map(messages.map(a => [a.id, a]));
  const previousMessage = (alert: Alert): Alert | undefined => {
    for (const id of alert.supersedes) {
      const known = old.get(id);
      if (known) return known;
      const intermediate = messagesById.get(id);
      if (intermediate) {
        const earlier = previousMessage(intermediate);
        if (earlier) return earlier;
      }
    }
    return undefined;
  };
  for (const alert of messages) {
    if (old.has(alert.id) || replaced.has(alert.id)) continue;
    const previous = previousMessage(alert);
    if (alert.kind === 'cancel' && (!previous || previous.kind === 'cancel')) continue;
    const downgraded = previous && (severity.indexOf(alert.severity) < severity.indexOf(previous.severity) || alert.severity === previous.severity && colors.includes(alert.color ?? '') && colors.includes(previous.color ?? '') && colors.indexOf(alert.color!) < colors.indexOf(previous.color!));
    const upgraded = previous && (severity.indexOf(alert.severity) > severity.indexOf(previous.severity) || alert.severity === previous.severity && colors.includes(alert.color ?? '') && colors.includes(previous.color ?? '') && colors.indexOf(alert.color!) > colors.indexOf(previous.color!));
    const id = alert.kind === 'cancel' ? 'alertCancelled' : previous ? downgraded ? 'alertDowngraded' : upgraded ? 'alertUpgraded' : 'alertUpdated' : 'alertAdded';
    const grade = alertGrade(alert), previousGrade = previous ? alertGrade(previous) : '';
    const action = id === 'alertCancelled' ? '取消' : previous && grade !== previousGrade ? `${previousGrade}→${grade}` : previous ? '更新' : '发布';
    const times = id === 'alertCancelled' ? [] : [alert.effectiveAt ? `生效${clock(alert.effectiveAt, timezone)}` : '', alert.onsetAt && alert.onsetAt !== alert.effectiveAt ? `预计${clock(alert.onsetAt, timezone)}开始` : '', alert.expiresAt ? `至${clock(alert.expiresAt, timezone)}` : ''].filter(Boolean);
    changes.push({ id, alertType: alert.event, text: `${alert.event}预警${action}${!previous && grade ? `（${grade}）` : ''}${times.length ? `（${times.join('，')}）` : ''}` });
  }
  const currentIds = new Set(messages.map(a => a.id));
  for (const alert of before) if (alert.kind !== 'cancel' && !currentIds.has(alert.id) && !replaced.has(alert.id)) changes.push({ id: alert.expiresAt && Date.parse(alert.expiresAt) <= now ? 'alertExpired' : 'alertRemoved', alertType: alert.event, text: `${alert.event}预警不再有效` });
  return changes;
}
