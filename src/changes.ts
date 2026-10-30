import type { RealtimeWeatherConfigSection } from './config.ts';
import { alertGrade, uvLevel, type Alert, type Change, type Weather } from './model.ts';
import { clock } from './time.ts';

export function precipitationRank(w: Weather): number {
  const ranks: Record<string, number> = { '305': 1, '309': 1, '306': 2, '307': 3, '310': 4, '311': 5, '312': 6, '400': 1, '401': 2, '402': 3, '403': 4, '408': 2, '409': 3, '410': 4 };
  return ranks[w.conditionCode] ?? ((w.precipitationIntensity ?? 0) <= 0 ? 0 : (w.precipitationIntensity ?? 0) < 2.5 ? 1 : (w.precipitationIntensity ?? 0) < 8 ? 2 : 3);
}

/** 数字基线只在对应阈值触发时前移；其他字段保持最近成功状态。 */
export function weatherChanges(before: Weather, current: Weather, cfg: RealtimeWeatherConfigSection): { changes: Change[]; baseline: Weather } {
  const changes: Change[] = [];
  const baseline: Weather = { ...current };
  const add = (id: string, text: string) => changes.push({ id, text });
  if (before.conditionCode !== current.conditionCode) {
    const id = ['100', '150'].includes(current.conditionCode) ? 'becameClear' : ['101', '102', '103', '104', '151', '152', '153'].includes(current.conditionCode) ? 'becameCloudy' : 'conditionChanged';
    add(id, `${before.condition}→${current.condition}`);
  }
  const oldType = before.precipitationType ?? 'unknown', newType = current.precipitationType ?? 'unknown';
  if (oldType !== newType) {
    if (newType === 'rain' || newType === 'snow') add(newType === 'rain' ? 'rainStarted' : 'snowStarted', `${newType === 'rain' ? '开始下雨' : '开始下雪'}`);
    else if (newType === 'none' && (oldType === 'rain' || oldType === 'snow')) add(oldType === 'rain' ? 'rainStopped' : 'snowStopped', oldType === 'rain' ? '雨停了' : '雪停了');
    else add('precipitationChanged', '降水类型改变');
  } else if (['rain', 'snow'].includes(newType) && precipitationRank(before) !== precipitationRank(current)) {
    const rising = precipitationRank(current) > precipitationRank(before);
    add(`${newType}${rising ? 'Stronger' : 'Weaker'}`, `${newType === 'rain' ? '雨势' : '雪势'}${rising ? '增强' : '减弱'}`);
  }
  for (const [key, threshold, unit, label, up, down] of [
    ['temperature', cfg.temperatureChange, '°C', '温度', 'temperatureUp', 'temperatureDown'],
    ['feelsLike', cfg.temperatureChange, '°C', '体感', 'feelsLikeUp', 'feelsLikeDown'],
    ['windScale', cfg.windScaleChange, '级', '风力', 'windUp', 'windDown'],
    ['precipitationProbability', cfg.precipitationProbabilityChange / 100, '', '降水概率', 'probabilityUp', 'probabilityDown'],
  ] as const) {
    const previous = before[key], value = current[key];
    if (previous === undefined || value === undefined) continue;
    if (Math.abs(value - previous) >= threshold) {
      const display = (n: number) => key === 'precipitationProbability' ? `${Math.round(n * 100)}%` : `${Math.round(n * 10) / 10}${unit}`;
      add(value > previous ? up : down, `${label}${display(previous)}→${display(value)}`);
    } else baseline[key] = previous;
  }
  if (before.visibilityKm !== undefined && current.visibilityKm !== undefined && (before.visibilityKm < cfg.visibilityThresholdKm) !== (current.visibilityKm < cfg.visibilityThresholdKm)) add(current.visibilityKm < cfg.visibilityThresholdKm ? 'visibilityDown' : 'visibilityUp', `能见度${before.visibilityKm}→${current.visibilityKm} km`);
  if (before.uv !== undefined && current.uv !== undefined && uvLevel(before.uv) !== uvLevel(current.uv)) add(current.uv > before.uv ? 'uvUp' : 'uvDown', `UV ${before.uv}→${current.uv}`);
  return { changes, baseline };
}

export function activeAlerts(alerts: Alert[], now: number): Alert[] {
  return alerts.filter(a => a.kind !== 'cancel' && (!a.expiresAt || Date.parse(a.expiresAt) > now));
}
export function alertChanges(before: Alert[], messages: Alert[], now: number, timezone = 'UTC'): Change[] {
  const changes: Change[] = [];
  const old = new Map(before.map(a => [a.id, a]));
  const replaced = new Set(messages.flatMap(a => a.supersedes));
  const severity = ['unknown', 'minor', 'moderate', 'severe', 'extreme'];
  const colors = ['white', 'green', 'blue', 'yellow', 'amber', 'orange', 'red', 'purple', 'black'];
  for (const alert of messages) {
    if (old.has(alert.id)) continue;
    const previous = alert.supersedes.map(id => old.get(id)).find(Boolean);
    const downgraded = previous && (severity.indexOf(alert.severity) < severity.indexOf(previous.severity) || alert.severity === previous.severity && colors.includes(alert.color ?? '') && colors.includes(previous.color ?? '') && colors.indexOf(alert.color!) < colors.indexOf(previous.color!));
    const id = alert.kind === 'cancel' ? 'alertCancelled' : previous ? downgraded ? 'alertDowngraded' : 'alertUpdated' : 'alertAdded';
    const grade = alertGrade(alert), previousGrade = previous ? alertGrade(previous) : '';
    const action = id === 'alertCancelled' ? '取消' : previous && grade !== previousGrade ? `${previousGrade}→${grade}` : previous ? '更新' : '发布';
    const times = id === 'alertCancelled' ? [] : [alert.effectiveAt ? `生效${clock(alert.effectiveAt, timezone)}` : '', alert.onsetAt && alert.onsetAt !== alert.effectiveAt ? `预计${clock(alert.onsetAt, timezone)}开始` : '', alert.expiresAt ? `至${clock(alert.expiresAt, timezone)}` : ''].filter(Boolean);
    changes.push({ id, text: `${alert.event}预警${action}${!previous && grade ? `（${grade}）` : ''}${times.length ? `（${times.join('，')}）` : ''}` });
  }
  const currentIds = new Set(messages.map(a => a.id));
  for (const alert of before) if (alert.kind !== 'cancel' && !currentIds.has(alert.id) && !replaced.has(alert.id)) changes.push({ id: alert.expiresAt && Date.parse(alert.expiresAt) <= now ? 'alertExpired' : 'alertRemoved', text: `${alert.event}预警不再有效` });
  return changes;
}
