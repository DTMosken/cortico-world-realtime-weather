import { coerceGroupValues } from 'cortico/core/config-schema.ts';
import { goodAir, pollutedAir, highAirRisk, lowerAirRisk } from './air-quality.ts';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { nowIso } from 'cortico/core/util.ts';
import type { Language } from 'cortico/core/language.ts';
import { REALTIME_WEATHER_SECRET, realtimeWeatherConfigGroup, type Location, type RealtimeWeatherConfigSection } from './config.ts';
import { apiBase, QWeather } from './qweather.ts';
import { Ambience } from './ambience.ts';
import { alertChanges, weatherChanges } from './changes.ts';
import { clock, isDaylight, solarTimes, nextDailyForecastAt } from './time.ts';
import { forecastTags, type ForecastSelection } from './forecast.ts';
import { airStandard, currentLine, dayLine, forecastLines } from './format.ts';
import { weatherTags, type Air, type Change, type Current, type Day, type Forecast, type Weather } from './model.ts';
import { ensureParent, openFile, prepareKeyFile } from './files.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
export const REALTIME_WEATHER_CURRENT_INTERVAL_MS = 15 * 60_000;
export const REALTIME_WEATHER_FORECAST_INTERVAL_MS = 60 * 60_000;
export const REALTIME_WEATHER_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  { name: 'realtime_weather_current', description: '查看配置地点的当前天气、空气质量与有效天气预警。', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'realtime_weather_forecast', description: '查看未来第1、第2小时与多日天气预报；明天天气取逐日摘要。', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
];
export interface RealtimeWeatherWorldOptions {
  request?: typeof fetch;
  now?: () => number;
  openFile?: (file: string) => Promise<void>;
  random?: () => number;
}
function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^(QWeather (HTTP \d{3}|请求未完成|响应格式错误)|密钥未配置|尚未选择城市或区划|空气质量暂无数据|API Host 须为)/.test(message) ? message : '响应处理失败';
}

export class RealtimeWeatherWorld implements World {
  readonly id = 'realtime-weather';
  readonly client: QWeather;
  readonly ambience: Ambience;
  private host?: WorldHost;
  private controller = new AbortController();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tasks = new Set<Promise<unknown>>();
  private currentFlight?: Promise<Current>;
  private airFlight?: Promise<PromiseSettledResult<Air>>;
  private forecastFlight?: Promise<Forecast>;
  private current?: Current;
  private forecast?: Forecast;
  private weatherBaseline?: Weather;
  private previous?: Current;
  private previousForecast?: Forecast;
  private cycle = 0;
  private airVisibilityBaseline?: number;
  private airHazeBaseline = false;
  private candidates: Location[] = [];
  private readonly now: () => number;
  private readonly open: (file: string) => Promise<void>;

  constructor(private readonly ctx: WorldContext<RealtimeWeatherConfigSection>, options: RealtimeWeatherWorldOptions = {}) {
    this.now = options.now ?? Date.now;
    this.open = options.openFile ?? openFile;
    this.client = new QWeather(ctx.cfg, () => ctx.secret(REALTIME_WEATHER_SECRET), options.request);
    this.ambience = new Ambience(join(ctx.botDir, 'worlds', this.id, 'ambience.json'), options.random);
  }
  envPromptVars(): Record<string, string> { return {}; }
  tools(): ToolDef[] {
    return REALTIME_WEATHER_TOOL_DECLS.map((decl, index) => ({ ...decl, handler: async () => {
      if (index === 0) {
        const current = this.current && !Object.keys(this.current.errors).length && this.now() - Date.parse(this.current.at) < REALTIME_WEATHER_CURRENT_INTERVAL_MS ? this.current : await this.loadCurrent(!this.current?.air || !!this.current.errors.air);
        return this.currentReceipt(current, 'active');
      }
      const forecast = this.forecast && !Object.keys(this.forecast.errors).length && this.now() - Date.parse(this.forecast.at) < REALTIME_WEATHER_FORECAST_INTERVAL_MS ? this.forecast : await this.loadForecast();
      return this.forecastReceipt(forecast, 'active');
    } }));
  }
  private timezone(): string { return this.ctx.timezone; }
  private tags(weather?: Weather): string[] {
    return [...(weather ? weatherTags(weather) : []), ...(this.ctx.cfg.location && isDaylight(this.now(), this.ctx.cfg.location) ? ['daylight'] : ['dark']), ...((weather?.windScale ?? 0) < 4 ? ['calm'] : []), ...(weather && (weatherTags(weather).some(tag => ['cloudy', 'fog'].includes(tag)) || ['rain', 'snow', 'mixed'].includes(weather.precipitationType ?? '')) ? ['cloudyOrWet'] : [])];
  }
  private currentReceipt(current: Current, trigger: 'active' | 'passive', changes?: Change[]): string {
    const weather = current.errors.weather ? undefined : current.weather;
    const tags = changes ? ['current', ...changes.map(c => c.id), ...this.tags(weather).filter(t => ['daylight', 'dark', 'calm', 'cloudyOrWet'].includes(t))] : ['current', ...this.tags(weather)];
    if (weather?.uv !== undefined) { if (weather.uv >= 7) tags.push('highUv'); if (weather.uv <= 2) tags.push('lowUv'); }
    if (current.air && goodAir(current.air) && weather?.visibilityKm !== undefined && this.airVisibilityBaseline !== undefined && weather.visibilityKm > this.airVisibilityBaseline) tags.push('clearerAir');
    if (weather && weatherTags(weather).some(tag => ['clear', 'cloudy'].includes(tag))) tags.push('clearAirWeather');
    if (this.airHazeBaseline && weather && weatherTags(weather).some(tag => ['clear', 'cloudy'].includes(tag))) tags.push('hazeClearedSinceAirBaseline');
    if (!changes && weather && current.air && highAirRisk(current.air) && weatherTags(weather).some(t => ['haze', 'dust'].includes(t))) tags.push('polluted');
    if (weather && (weather.windScale ?? 0) >= 5 && changes?.some(c => c.id === 'windUp')) tags.push('strongWind');
    if (weather && weatherTags(weather).includes('fog') && (!current.air || lowerAirRisk(current.air))) tags.push('waterFog');
    if (this.previous?.weather && weatherTags(this.previous.weather).includes('fog') && (!this.previous.air || lowerAirRisk(this.previous.air)) && weather && ![500, 501, 509, 510, 514, 515].includes(Number(weather.conditionCode))) tags.push('wasWaterFog');
    if (weather?.visibilityKm !== undefined && this.previous?.weather?.visibilityKm !== undefined && weather.visibilityKm < this.previous.weather.visibilityKm) tags.push('visibilityFell');
    if (weather?.windScale !== undefined && weather.windScale >= 3 && weather.windScale < 5) tags.push('moderateWind');
    if (current.air && !current.errors.air) {
      if (goodAir(current.air)) tags.push('goodAir');
      if (pollutedAir(current.air)) tags.push('pollutedAir');
      if (!tags.includes('clearerAir')) tags.push('airWithoutClearerView');
      if (lowerAirRisk(current.air)) tags.push('notSeverelyPolluted');
    } else if (!current.air) tags.push('notSeverelyPolluted');
    if (weather?.visibilityKm !== undefined && this.previous?.weather?.visibilityKm !== undefined && weather.visibilityKm >= this.previous.weather.visibilityKm) tags.push('visibilityNotFallen');
    if (weather && weather.condition !== '未知') tags.push([500, 501, 509, 510, 514, 515].includes(Number(weather.conditionCode)) ? 'fogPresent' : 'noFog');
    const alertTypes = Object.fromEntries((changes ?? []).filter(c => c.alertType).map(c => [c.id, [...new Set(changes!.filter(other => other.id === c.id).map(other => other.alertType))].join('、')]));
    const atmosphere = this.ambience.render('current', trigger, current.at, this.timezone(), tags, alertTypes);
    const data = changes ? `${clock(current.at, this.timezone())}｜${changes.map(c => c.text).join('｜')}` : currentLine(current, this.timezone());
    return [data, atmosphere].filter(Boolean).join('\n\n');
  }
  private forecastReceipt(forecast: Forecast, trigger: 'active' | 'passive', changes?: Change[], selection?: ForecastSelection): string {
    const tags = forecastTags(forecast, this.current?.errors.weather ? undefined : this.current?.weather, this.ctx.cfg, this.timezone(), selection);
    const atmosphere = this.ambience.render('forecast', trigger, forecast.at, this.timezone(), tags);
    const data = changes ? `${clock(forecast.at, this.timezone())}\n${changes.map(c => c.text).join('\n')}` : forecastLines(forecast, this.timezone());
    return [data, atmosphere].filter(Boolean).join('\n\n');
  }

  private loadCurrent(refreshAir: boolean): Promise<Current> {
    if (refreshAir && !this.airFlight) {
      this.airFlight = this.client.air(new Date(this.now()).toISOString(), this.host ? this.controller.signal : undefined)
        .then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }));
    }
    if (this.currentFlight) return this.currentFlight;
    const signal = this.host ? this.controller.signal : undefined;
    const flight = (async () => {
      const at = new Date(this.now()).toISOString();
      const result: Current = { at, weather: this.current?.weather, air: this.current?.air, alerts: this.current?.alerts ?? [], weatherAt: this.current?.weatherAt, alertsAt: this.current?.alertsAt, errors: {} };
      const [weather, alerts] = await Promise.allSettled([this.client.current(signal), this.client.alerts(signal)]);
      if (weather.status === 'fulfilled') { result.weather = weather.value; result.weatherAt = at; } else result.errors.weather = errorText(weather.reason);
      if (alerts.status === 'fulfilled') { result.alerts = alerts.value; result.alertsAt = at; } else result.errors.alerts = errorText(alerts.reason);
      if (this.airFlight) {
        const air = await this.airFlight;
        if (air.status === 'fulfilled') result.air = air.value; else result.errors.air = errorText(air.reason);
        this.airFlight = undefined;
      } else if (this.current?.errors.air) result.errors.air = this.current.errors.air;
      this.current = result;
      return result;
    })();
    this.currentFlight = flight;
    this.tasks.add(flight);
    void flight.finally(() => { this.tasks.delete(flight); this.currentFlight = undefined; });
    return flight;
  }
  private loadForecast(): Promise<Forecast> {
    if (this.forecastFlight) return this.forecastFlight;
    const signal = this.host ? this.controller.signal : undefined;
    const flight = (async () => {
      const result: Forecast = { at: new Date(this.now()).toISOString(), hours: this.forecast?.hours ?? [], days: this.forecast?.days ?? [], hoursAt: this.forecast?.hoursAt, daysAt: this.forecast?.daysAt, errors: {} };
      const [hours, days] = await Promise.allSettled([this.client.hourly(signal), this.client.daily(signal)]);
      if (hours.status === 'fulfilled') { result.hours = hours.value; result.hoursAt = result.at; } else result.errors.hours = errorText(hours.reason);
      if (days.status === 'fulfilled') { result.days = days.value; result.daysAt = result.at; } else result.errors.days = errorText(days.reason);
      this.forecast = result;
      return result;
    })();
    this.forecastFlight = flight;
    this.tasks.add(flight);
    void flight.finally(() => { this.tasks.delete(flight); this.forecastFlight = undefined; });
    return flight;
  }
  async pollCurrent(notify = true): Promise<void> {
    const host = this.host;
    const current = await this.loadCurrent(this.cycle++ % 4 === 0);
    const changes: Change[] = [];
    if (current.weather && !current.errors.weather) {
      if (this.weatherBaseline) {
        const result = weatherChanges(this.weatherBaseline, current.weather, this.ctx.cfg);
        changes.push(...result.changes); this.weatherBaseline = result.baseline;
      } else this.weatherBaseline = current.weather;
    }
    if (this.previous?.air && current.air && current.air.standard === this.previous.air.standard && current.air.level !== this.previous.air.level) changes.push({ id: current.air.level > this.previous.air.level ? 'airDown' : 'airUp', text: `AQI(${airStandard(current.air.standard)}) ${this.previous.air.value}（${this.previous.air.category}）→${current.air.value}（${current.air.category}，${clock(current.air.at, this.timezone())}）` });
    if (!current.errors.alerts) {
      current.alerts = current.alerts.filter(a => a.kind === 'cancel' || !a.expiresAt || Date.parse(a.expiresAt) > this.now());
      changes.push(...alertChanges(this.previous?.alerts ?? [], current.alerts, this.now(), this.timezone()));
    }
    const receipt = changes.length ? this.currentReceipt(current, 'passive', changes) : '';
    if (current.air && !current.errors.air && !current.errors.weather && (this.airVisibilityBaseline === undefined || this.previous?.air?.standard !== current.air.standard || !(this.previous?.air && goodAir(this.previous.air)) && goodAir(current.air) || (this.previous?.air && current.air.level > this.previous.air.level))) {
      this.airVisibilityBaseline = current.weather?.visibilityKm;
      this.airHazeBaseline = !!current.weather && weatherTags(current.weather).includes('haze');
    }
    this.previous = current;
    if (notify && receipt && host && this.host === host && !this.controller.signal.aborted) await this.push('realtime-weather.changed', receipt);
  }
  async pollForecast(mode: 'changes' | 'summary' | 'silent' = 'changes'): Promise<void> {
    const host = this.host;
    const current = await this.loadForecast();
    const changes: Change[] = [];
    const next: Forecast = { ...current, hours: [], days: [] };
    const selection: ForecastSelection = { hours: new Map(), days: new Map() };
    const visibleHours = new Set(current.hours.filter(h => Date.parse(h.at) > this.now()).slice(0, 2).map(h => h.at));
    for (const hour of current.hours) {
      const old = this.previousForecast?.hours.find(h => h.at === hour.at);
      if (current.errors.hours) { next.hours.push(old ?? hour); continue; }
      if (old) {
        const result = weatherChanges(old, hour, this.ctx.cfg);
        if (result.changes.length && visibleHours.has(hour.at)) {
          changes.push({ id: 'hourChanged', text: `${clock(hour.at, this.timezone())}｜${result.changes.map(c => c.text).join('｜')}` });
          selection.hours.set(hour.at, result.changes);
        }
        next.hours.push({ ...result.baseline, at: hour.at });
      } else next.hours.push(hour);
    }
    for (const day of current.days) {
      const old = this.previousForecast?.days.find(d => d.date === day.date);
      if (current.errors.days) { next.days.push(old ?? day); continue; }
      const dayChanges: Change[] = [];
      const baseline: Day = { ...day };
      let changed = false;
      if (old && !current.errors.days) {
        for (const part of ['daytime', 'nighttime'] as const) {
          const result = weatherChanges(old[part], day[part], this.ctx.cfg);
          baseline[part] = result.baseline;
          dayChanges.push(...result.changes);
          changed ||= result.changes.length > 0;
        }
        for (const key of ['min', 'max'] as const) if (old[key] !== undefined && day[key] !== undefined) {
          if (Math.abs(day[key]! - old[key]!) >= this.ctx.cfg.temperatureChange) { changed = true; dayChanges.push({ id: day[key]! > old[key]! ? 'temperatureUp' : 'temperatureDown', text: '' }); }
          else baseline[key] = old[key];
        }
        if (old.uv !== undefined && day.uv !== undefined && Math.floor(old.uv) !== Math.floor(day.uv)) {
          const uvChanges = weatherChanges({ ...old.daytime, uv: old.uv }, { ...day.daytime, uv: day.uv }, this.ctx.cfg);
          changed ||= uvChanges.changes.some(c => c.id === 'uvUp' || c.id === 'uvDown');
        }
      }
      if (changed) { changes.push({ id: 'dayChanged', text: dayLine(day) }); selection.days.set(day.date, dayChanges); }
      next.days.push(baseline);
    }
    this.previousForecast = next;
    if (mode !== 'silent' && (mode === 'summary' || changes.length) && host && this.host === host && !this.controller.signal.aborted) {
      await this.push('realtime-weather.forecast', mode === 'summary' ? this.forecastReceipt(current, 'passive') : this.forecastReceipt(current, 'passive', changes, selection));
    }
  }
  private async push(type: string, text: string): Promise<void> {
    await this.host!.pushEvent({ type, source: this.id, senderKey: this.id, origin: 'external', ts: nowIso(this.ctx.timezone), text });
  }
  private schedule(run: () => Promise<void>, interval: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.host) return;
      const task = run().catch(() => { this.host?.log.warn('天气轮询未完成'); }).finally(() => { this.tasks.delete(task); if (this.host) this.schedule(run, interval); });
      this.tasks.add(task);
    }, interval);
    timer.unref(); this.timers.add(timer);
  }
  private scheduleDailyForecast(): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.host) return;
      const task = this.pollForecast('summary')
        .catch(() => { this.host?.log.warn('每日预报未完成'); })
        .finally(() => { this.tasks.delete(task); if (this.host) this.scheduleDailyForecast(); });
      this.tasks.add(task);
    }, nextDailyForecastAt(this.now(), this.timezone()) - this.now());
    timer.unref(); this.timers.add(timer);
  }
  private scheduleSolar(): void {
    if (!this.ctx.cfg.location || !this.host) return;
    const now = this.now(), location = this.ctx.cfg.location;
    const events: { at: number; kind: 'sunrise' | 'sunset' }[] = [];
    for (const dayOffset of [0, 1]) {
      const times = solarTimes(now + dayOffset * 24 * 60 * 60_000, location, this.timezone());
      for (const kind of ['sunrise', 'sunset'] as const) if (times[kind] && times[kind]!.getTime() > now) events.push({ at: times[kind]!.getTime(), kind });
    }
    const next = events.sort((a, b) => a.at - b.at)[0];
    const delay = next ? next.at - now : 12 * 60 * 60_000;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.host) return;
      const run = async () => {
        if (next) {
          const at = new Date(this.now()).toISOString();
          const atmosphere = this.ambience.render(next.kind, 'passive', at, this.timezone(), this.tags(this.current?.weather));
          await this.push('realtime-weather.solar', [`${clock(at, this.timezone())}｜${next.kind === 'sunrise' ? '日出' : '日落'}${this.current?.weather ? `｜${this.current.weather.condition}` : ''}`, atmosphere].filter(Boolean).join('\n\n'));
        }
      };
      const task = run().catch(() => { this.host?.log.warn('日出日落事件未完成'); }).finally(() => { this.tasks.delete(task); if (this.host) this.scheduleSolar(); });
      this.tasks.add(task);
    }, delay);
    timer.unref(); this.timers.add(timer);
  }
  async start(host: WorldHost): Promise<void> {
    if (this.ctx.cfg.location && 'timezone' in this.ctx.cfg.location) {
      const { timezone: _timezone, ...location } = this.ctx.cfg.location;
      this.ctx.persist({ location: null });
      this.ctx.persist({ location });
    }
    this.host = host; this.controller = new AbortController(); this.ambience.start();
    if (!this.ctx.cfg.location || !this.ctx.cfg.apiHost || !this.ctx.secret(REALTIME_WEATHER_SECRET)) return;
    await Promise.all([this.pollCurrent(false), this.pollForecast('silent')]);
    if (this.host !== host || this.controller.signal.aborted) return;
    await this.push('realtime-weather.summary', [this.currentReceipt(this.current!, 'passive'), this.forecastReceipt(this.forecast!, 'passive')].join('\n\n'));
    this.schedule(() => this.pollCurrent(), REALTIME_WEATHER_CURRENT_INTERVAL_MS);
    this.schedule(() => this.pollForecast(), REALTIME_WEATHER_FORECAST_INTERVAL_MS);
    this.scheduleSolar();
    this.scheduleDailyForecast();
  }
  async stop(): Promise<void> {
    this.host = undefined; this.controller.abort();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear(); this.ambience.stop();
    await Promise.allSettled([...this.tasks]);
  }

  webUi(language?: Language): WorldWebUiDecl {
    const loading = !!this.currentFlight || !!this.forecastFlight || !!this.airFlight;
    const failed = Object.keys({ ...this.current?.errors, ...this.forecast?.errors }).length > 0;
    const state = loading ? 'loading' : failed ? 'error' : this.current && this.forecast ? 'online' : 'offline';
    return {
      lamps: [{ label: 'QWeather', state, hint: state === 'online' ? '最近一次天气与预报查询成功' : state === 'error' ? '最近一次查询有接口失败' : state === 'loading' ? '正在查询天气' : '尚未完成天气与预报查询' }],
      label: '实时天气',
      badges: [{ label: 'QWeather', value: this.ctx.secret(REALTIME_WEATHER_SECRET) ? '密钥已配置' : '密钥未配置' }, { label: '地点', value: this.ctx.cfg.location?.name ?? '未选择' }],
      panels: [{ id: 'config', title: '配置' }],
      promptDocs: [{ key: 'worlds.realtime-weather.envPrompt', title: '实时天气 · 环境提示词', description: '天气工具、时间与氛围叙述的含义。', path: ENV_PROMPT_FILE, role: 'envPrompt' }],
      invoke: async (panel, method, args) => {
        if (panel !== 'config') throw new Error('未知面板');
        if (method === 'state') {
          this.ambience.reload();
          return { config: this.ctx.cfg, keySet: !!this.ctx.secret(REALTIME_WEATHER_SECRET), ambience: { file: this.ambience.file, usingDefault: this.ambience.usingDefault, error: this.ambience.error }, errors: { ...this.current?.errors, ...this.forecast?.errors }, alerts: this.client.rawAlerts, attributions: [...this.client.attributions] };
        }
        if (method === 'save') {
          const [key, raw] = args;
          if (typeof key !== 'string' || key === 'location') throw new Error('未知配置项');
          const path = `worlds.realtime-weather.${key}`;
          const result = coerceGroupValues(realtimeWeatherConfigGroup(language), { [path]: raw }, language);
          if ('error' in result) throw new Error(result.error);
          const value = result.values[path];
          if (key === 'apiHost' && value) apiBase(String(value));
          this.ctx.persist({ [key]: value });
          if (key === 'apiHost') await this.ctx.restart();
          return { ok: true };
        }
        if (method === 'searchCities') {
          if (typeof args[0] !== 'string' || !args[0].trim()) throw new Error('请输入城市或区划名称');
          if (args[1] !== undefined && typeof args[1] !== 'string') throw new Error('上级行政区须为文本');
          if (args[2] !== undefined && typeof args[2] !== 'string') throw new Error('国家或地区代码须为文本');
          this.candidates = await this.client.cities(args[0], { adm: args[1] as string | undefined, range: args[2] as string | undefined }); return this.candidates;
        }
        if (method === 'selectCity') {
          const selected = this.candidates.find(c => c.id === args[0]);
          if (!selected) throw new Error('请从本次搜索结果选择地点');
          this.ctx.persist({ location: selected }); await this.ctx.restart(); return { ok: true };
        }
        if (method === 'openKeyFile') { await this.open(prepareKeyFile(this.ctx.botDir)); return { ok: true }; }
        if (method === 'openAmbience') { ensureParent(this.ambience.file); this.ambience.ensureFile(); await this.open(this.ambience.file); return { ok: true }; }
        if (method === 'restoreAmbience') { ensureParent(this.ambience.file); this.ambience.restore(); return { ok: true }; }
        if (method === 'testConnection') {
          const start = this.now();
          const [current, forecast] = await Promise.all([this.loadCurrent(true), this.loadForecast()]);
          const result = { durationMs: this.now() - start, errors: { ...current.errors, ...forecast.errors } };
          if (current.weather) await this.ctx.restart();
          return result;
        }
        if (method === 'restart') { await this.ctx.restart(); return { ok: true }; }
        throw new Error('未知操作');
      },
    };
  }
}
