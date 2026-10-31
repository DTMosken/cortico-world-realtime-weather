import type { Change, Forecast, Weather } from './model.ts';
import { weatherTags } from './model.ts';
import { dateKey } from './time.ts';
import { precipitationRank, weatherChanges } from './changes.ts';
import type { RealtimeWeatherConfigSection } from './config.ts';

export interface ForecastSelection {
  hours: Map<string, Change[]>;
  days: Map<string, Change[]>;
}

/** Passive prose uses changed slots and the changed weather dimensions only. */
export function forecastTags(forecast: Forecast, current: Weather | undefined, cfg: RealtimeWeatherConfigSection, timezone: string, selection?: ForecastSelection): string[] {
  const threshold = cfg.temperatureChange;
  const tags = new Set<string>();
  const hours = forecast.errors.hours ? [] : forecast.hours.filter(h => Date.parse(h.at) > Date.parse(forecast.at));
  const visible = hours.slice(0, 2);
  const days = forecast.errors.days ? [] : forecast.days;
  const today = dateKey(Date.parse(forecast.at), timezone);
  const wet = (w: Weather) => ['rain', 'snow', 'mixed'].includes(w.precipitationType ?? '');
  for (const [index, hour] of visible.entries()) {
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
    const previous = index === 0 ? current : visible[index - 1];
    if (!previous) continue;
    const trend = weatherChanges(previous, hour, cfg).changes.map(c => c.id);
    const changed = (prefix: string) => !ids || ids.some(id => id.startsWith(prefix));
    for (const dimension of ['wind', 'visibility', 'uv'] as const) {
      if (!changed(dimension)) continue;
      for (const direction of ['Up', 'Down']) if (trend.includes(`${dimension}${direction}`)) {
        if (dimension === 'uv' && direction === 'Up' && (hour.uv ?? 0) < 7) continue;
        tags.add(`forecast${dimension[0].toUpperCase()}${dimension.slice(1)}${direction}`);
      }
    }
    if (!ids || ids.some(id => /^(rain|snow|mixed|precipitation|condition|thunder)/.test(id))) {
      if (current?.precipitationType === 'rain') {
        if (trend.includes('rainStopped')) tags.add('forecastRainStopped');
        if (trend.includes('rainWeaker') && ((precipitationRank(current) ?? 0) >= 2 || (current.precipitationIntensity ?? 0) >= 2.5)) tags.add('forecastRainWeaker');
      }
      if (trend.includes('snowStarted') || trend.includes('rainToSnow') && hour.precipitationType === 'snow') tags.add('forecastSnowStarted');
      if (current?.precipitationType === 'snow') {
        if (trend.includes('snowStopped')) tags.add('forecastSnowStopped');
        if (trend.includes('snowStronger')) tags.add('forecastSnowStronger');
        if (trend.includes('snowWeaker') && (precipitationRank(current) ?? 0) >= 3) tags.add('forecastSnowWeaker');
      }
    }
  }
  // Daily extrema compare with the preceding date, not a daytime observation.
  for (let index = 1; index < days.length; index++) {
    const before = days[index - 1], day = days[index];
    if (day.date <= today) continue;
    const changes = selection?.days.get(day.date);
    if (selection && !changes) continue;
    const deltas = (['min', 'max'] as const).flatMap(key => day[key] !== undefined && before[key] !== undefined ? [day[key]! - before[key]!] : []);
    if (deltas.some(delta => delta <= -threshold) && (!changes || changes.some(c => c.id === 'temperatureDown'))) tags.add('forecastDailyCold');
  }
  const futureDays = days.filter(day => day.date > today);
  // "一路上涨" requires a multi-day rising run, not one isolated warmer day.
  for (let start = 0; start <= futureDays.length - 3; start++) {
    const run = futureDays.slice(start, start + 3);
    const rising = (['min', 'max'] as const).every(key => run.every(day => day[key] !== undefined) && run[1][key]! > run[0][key]! && run[2][key]! > run[1][key]!) && (['min', 'max'] as const).some(key => run[2][key]! - run[0][key]! >= threshold);
    const relevant = !selection || run.some(day => selection.days.get(day.date)?.some(c => c.id === 'temperatureUp'));
    if (rising && relevant) {
      tags.add('forecastDailyWarm');
      const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      const todayForecast = days.find(day => day.date === today);
      if (run[0].date === tomorrow && todayForecast && (['min', 'max'] as const).every(key => todayForecast[key] !== undefined && run[0][key]! > todayForecast[key]!)) tags.add('forecastDailyWarmFromTomorrow');
    }
  }
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
