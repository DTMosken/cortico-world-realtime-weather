import type { Alert, Current, Day, Forecast, Weather } from './model.ts';
import { alertGrade, UV_NAMES, uvLevel } from './model.ts';
import { activeAlerts } from './changes.ts';
import { clock } from './time.ts';

export const airStandard = (standard: string) => standard === 'cn-mee' ? 'CN' : standard.toUpperCase();
export const number = (n: number) => String(Math.round(n * 10) / 10);
export function weatherLine(w: Weather, forecast = false): string {
  const parts = [w.condition + (w.precipitationIntensity === undefined || !['rain', 'snow', 'mixed'].includes(w.precipitationType ?? '') ? '' : `${number(w.precipitationIntensity)} mm/h`)];
  if (w.temperature !== undefined) parts.push(`${number(w.temperature)}°C${w.feelsLike === undefined ? '' : `，体感${number(w.feelsLike)}°C`}`);
  else if (w.feelsLike !== undefined) parts.push(`体感${number(w.feelsLike)}°C`);
  if (w.windScale !== undefined) parts.push(`${w.windDirection ?? ''}风${w.windScale}级`);
  if (w.visibilityKm !== undefined) parts.push(`能见度${number(w.visibilityKm)} km`);
  if (w.uv !== undefined) parts.push(`UV ${number(w.uv)}（${UV_NAMES[uvLevel(w.uv)]}）`);
  if (forecast && w.precipitationProbability !== undefined) parts.push(`降水${Math.round(w.precipitationProbability * 100)}%`);
  return parts.join('｜');
}
export function alertLine(alert: Alert, timezone: string): string {
  const times: string[] = [];
  if (alert.effectiveAt) times.push(`生效${clock(alert.effectiveAt, timezone)}`);
  if (alert.onsetAt && alert.onsetAt !== alert.effectiveAt) times.push(`预计${clock(alert.onsetAt, timezone)}开始`);
  if (alert.expiresAt) times.push(`至${clock(alert.expiresAt, timezone)}`);
  return `${alert.event}${alertGrade(alert)}预警${times.length ? `（${times.join('，')}）` : ''}`;
}
export function currentLine(snapshot: Current, timezone: string): string {
  const parts = [clock(snapshot.at, timezone), snapshot.weather ? weatherLine(snapshot.weather) + (snapshot.errors.weather && snapshot.weatherAt ? `（沿用${clock(snapshot.weatherAt, timezone)}）` : '') : '天气暂无数据'];
  if (snapshot.air) {
    const air = snapshot.air;
    const standard = airStandard(air.standard);
    parts.push(`AQI(${standard}) ${air.value}（${air.category}，${clock(air.at, timezone)}）${air.primary ? `，首要${air.primary}` : ''}`);
  } else parts.push('空气质量暂无数据');
  const alerts = activeAlerts(snapshot.alerts, Date.parse(snapshot.at));
  parts.push(snapshot.errors.alerts ? `预警${snapshot.errors.alerts}` : alerts.length ? alerts.map(a => alertLine(a, timezone)).join('；') : '无有效预警');
  for (const kind of ['weather', 'air'] as const) if (snapshot.errors[kind]) parts.push(`${kind === 'weather' ? '天气' : '空气质量'}${snapshot.errors[kind]}`);
  return parts.join('｜');
}
export function dayLine(day: Day): string {
  const parts = [day.date.slice(5).replace('-', '/'), `${day.daytime.condition}/${day.nighttime.condition}`];
  if (day.min !== undefined && day.max !== undefined) parts.push(`${number(day.min)}–${number(day.max)}°C`);
  const probabilities = [day.daytime.precipitationProbability, day.nighttime.precipitationProbability].filter((v): v is number => v !== undefined);
  const amounts = [day.daytime.precipitationAmount, day.nighttime.precipitationAmount].filter((v): v is number => v !== undefined);
  if (probabilities.length) parts.push(`降水${Math.round(Math.max(...probabilities) * 100)}%${amounts.length === 2 ? `/${number(amounts[0] + amounts[1])} mm` : ''}`);
  const winds = [day.daytime.windScale, day.nighttime.windScale].filter((v): v is number => v !== undefined);
  if (winds.length) parts.push(`${day.daytime.windDirection ?? day.nighttime.windDirection ?? ''}风${Math.min(...winds)}${Math.max(...winds) === Math.min(...winds) ? '' : `–${Math.max(...winds)}`}级`);
  if (day.uv !== undefined) parts.push(`UV最高${day.uv}`);
  return parts.join('｜');
}
export function forecastLines(snapshot: Forecast, timezone: string): string {
  const hours = snapshot.hours.filter(h => Date.parse(h.at) > Date.parse(snapshot.at)).slice(0, 2);
  const missing = [hours.length < 2 ? `未来第${hours.length + 1}${hours.length === 0 ? '、2' : ''}小时暂无预报` : '', !snapshot.days.length ? '多日暂无预报' : ''].filter(Boolean);
  const stale = [snapshot.errors.hours && snapshot.hoursAt ? `逐小时沿用${clock(snapshot.hoursAt, timezone)}预报` : '', snapshot.errors.days && snapshot.daysAt ? `多日沿用${clock(snapshot.daysAt, timezone)}预报` : ''].filter(Boolean);
  return [clock(snapshot.at, timezone), ...missing, ...stale, ...hours.map(h => `${clock(h.at, timezone)}｜${weatherLine(h, true)}`), ...snapshot.days.map(dayLine), ...Object.entries(snapshot.errors).map(([key, value]) => `${key === 'hours' ? '逐小时' : '多日'}预报${value}`)].join('\n');
}
