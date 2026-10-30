import type { Change, Forecast, Weather } from './model.ts';
import { weatherTags } from './model.ts';
import { dateKey } from './time.ts';

export interface ForecastSelection {
  hours: Map<string, Change[]>;
  days: Map<string, Change[]>;
}

/** Passive prose uses changed slots and the changed weather dimensions only. */
export function forecastTags(forecast: Forecast, current: Weather | undefined, threshold: number, timezone: string, selection?: ForecastSelection): string[] {
  const tags = new Set<string>();
  const hours = forecast.errors.hours ? [] : forecast.hours.filter(h => Date.parse(h.at) > Date.parse(forecast.at));
  const visible = hours.slice(0, 2);
  const days = forecast.errors.days ? [] : forecast.days;
  const today = dateKey(Date.parse(forecast.at), timezone);
  const wet = (w: Weather) => ['rain', 'snow', 'mixed'].includes(w.precipitationType ?? '');
  for (const hour of visible) {
    const changes = selection?.hours.get(hour.at);
    if (selection && !changes) continue;
    const ids = changes?.map(c => c.id);
    const rain = hour.precipitationType === 'rain';
    if (rain && (hour.precipitationProbability ?? 0) > 0.7 && (!ids || ids.some(id => ['rainStarted', 'rainStronger', 'snowToRain', 'conditionChanged', 'probabilityUp'].includes(id)))) tags.add('forecastRain');
    for (const direction of ['Up', 'Down']) {
      if (['rain', 'none'].includes(hour.precipitationType ?? '') && ids?.includes(`probability${direction}`)) tags.add(`probability${direction}`);
    }
    if (current?.temperature !== undefined && hour.temperature !== undefined) {
      if (hour.temperature <= current.temperature - threshold && (!ids || ids.includes('temperatureDown'))) tags.add('forecastCold');
      if (hour.temperature >= current.temperature + threshold && (!ids || ids.includes('temperatureUp'))) tags.add('forecastWarm');
    }
  }
  // Daily extrema compare with the preceding date, not a daytime observation.
  for (let index = 1; index < days.length; index++) {
    const before = days[index - 1], day = days[index];
    if (day.date <= today) continue;
    const changes = selection?.days.get(day.date);
    if (selection && !changes) continue;
    const deltas = (['min', 'max'] as const).flatMap(key => day[key] !== undefined && before[key] !== undefined ? [day[key]! - before[key]!] : []);
    if (deltas.some(delta => delta <= -threshold) && (!changes || changes.some(c => c.id === 'temperatureDown'))) tags.add('forecastCold');
    if (deltas.some(delta => delta >= threshold) && (!changes || changes.some(c => c.id === 'temperatureUp'))) tags.add('forecastDailyWarm');
  }
  const futureDays = days.filter(day => day.date > today);
  for (const [tag, matches] of [
    ['forecastWet', (day: typeof days[number]) => day.daytime.precipitationType === 'rain' || day.nighttime.precipitationType === 'rain'],
    ['forecastClear', (day: typeof days[number]) => weatherTags(day.daytime).includes('clear') && !wet(day.nighttime)],
  ] as const) {
    const run: typeof days = [];
    for (const day of futureDays) { if (!matches(day)) break; run.push(day); }
    if (run.length >= 2 && (!selection || run.some(day => selection.days.get(day.date)?.some(c => ['conditionChanged', 'becameClear', 'becameCloudy', 'rainStarted', 'rainStopped', 'rainToSnow', 'snowToRain'].includes(c.id))))) tags.add(tag);
  }
  const mild = (w: Weather) => w.temperature !== undefined && w.temperature >= 15 && w.temperature <= 25;
  const steady = (w: Weather) => current?.temperature !== undefined && w.temperature !== undefined && Math.abs(w.temperature - current.temperature) < threshold && w.precipitationType === 'none' && w.precipitationProbability !== undefined && w.precipitationProbability < 0.3 && w.windScale !== undefined && w.windScale < 5 && weatherTags(w).some(t => ['clear', 'cloudy'].includes(t));
  // Daily changes cannot select an unrelated short-term steady-weather sentence.
  if ((!selection || selection.hours.size > 0 && selection.days.size === 0) && !tags.size && visible.length === 2 && visible.every(steady)) {
    tags.add('forecastStable');
    if (hours.length >= 3 && hours.slice(0, 3).every(w => steady(w) && mild(w)) && current && mild(current)) tags.add('forecastMild');
  }
  return [...tags];
}
