import { airCategory } from './air-quality.ts';
import type { Location, RealtimeWeatherConfigSection } from './config.ts';
import type { Air, Alert, Day, Hour, Weather } from './model.ts';

interface Value { value: number; unit?: string }
interface RawWeather {
  condition?: { code: string };
  temperature?: Value;
  feelsLike?: Value;
  humidity?: number;
  wind?: { direction?: { compass?: string }; scale?: number };
  precipitation?: { type?: string; intensity?: Value; amount?: Value; probability?: number };
  visibility?: Value;
  uvIndex?: number;
}
interface RawDay {
  forecastStartTime: string;
  temperatureMin?: Value;
  temperatureMax?: Value;
  uvIndexMax?: number;
  daytime: RawWeather;
  nighttime: RawWeather;
}
export interface RawAlert {
  id: string;
  eventType: { name: string; code: string };
  severity: string;
  color?: { code: string };
  urgency?: string;
  certainty?: string;
  issuedTime?: string;
  effectiveTime?: string;
  onsetTime?: string;
  expireTime?: string;
  messageType: { code: string; supersedes?: string[] };
  headline?: string;
  description?: string;
  senderName?: string;
}
interface Metadata { attributions?: string[]; zeroResult?: boolean }
const CONDITIONS: Record<string, string> = {
  '100': '晴', '101': '多云', '102': '少云', '103': '晴间多云', '104': '阴',
  '150': '晴', '151': '多云', '152': '少云', '153': '晴间多云',
  '300': '阵雨', '301': '强阵雨', '302': '雷阵雨', '303': '强雷阵雨', '304': '雷阵雨伴冰雹',
  '305': '小雨', '306': '中雨', '307': '大雨', '308': '极端降雨', '309': '毛毛雨', '310': '暴雨',
  '311': '大暴雨', '312': '特大暴雨', '313': '冻雨', '314': '小到中雨', '315': '中到大雨', '316': '大到暴雨',
  '317': '暴雨到大暴雨', '318': '大暴雨到特大暴雨', '350': '阵雨', '351': '强阵雨', '399': '雨',
  '400': '小雪', '401': '中雪', '402': '大雪', '403': '暴雪', '404': '雨夹雪', '405': '雨雪天气',
  '406': '阵雨夹雪', '407': '阵雪', '408': '小到中雪', '409': '中到大雪', '410': '大到暴雪', '456': '阵雨夹雪', '457': '阵雪', '499': '雪',
  '500': '薄雾', '501': '雾', '502': '霾', '503': '扬沙', '504': '浮尘', '507': '沙尘暴', '508': '强沙尘暴',
  '509': '浓雾', '510': '强浓雾', '511': '中度霾', '512': '重度霾', '513': '严重霾', '514': '大雾', '515': '特强浓雾',
  '900': '热', '901': '冷', '999': '未知',
};
const DIRECTIONS: Record<string, string> = { n: '北', nne: '东北偏北', ne: '东北', ene: '东北偏东', e: '东', ese: '东南偏东', se: '东南', sse: '东南偏南', s: '南', ssw: '西南偏南', sw: '西南', wsw: '西南偏西', w: '西', wnw: '西北偏西', nw: '西北', nnw: '西北偏北', calm: '静', vrb: '不定向', none: '静' };
const EVENTS: Record<string, string> = { wind: '大风', rain: '暴雨', rainfall: '暴雨', snow: '暴雪', snowfall: '暴雪', thunderstorm: '雷电', lightning: '雷电', typhoon: '台风', hurricane: '飓风', cyclone: '热带气旋', tornado: '龙卷风', heat: '高温', cold: '寒潮', fog: '大雾', flood: '洪水', dust: '沙尘', hail: '冰雹' };
const POLLUTANTS: Record<string, string> = { pm2p5: 'PM2.5', pm10: 'PM10', o3: 'O₃', no2: 'NO₂', so2: 'SO₂', co: 'CO' };
const EVENT_CODES: Record<string, string> = {
  '1001': '台风', '1002': '龙卷风', '1003': '暴雨', '1004': '暴雪', '1005': '寒潮', '1006': '大风', '1007': '沙尘暴', '1008': '低温冰冻', '1009': '高温', '1010': '热浪', '1011': '干热风', '1012': '下击暴流', '1013': '雪崩', '1014': '雷电', '1015': '冰雹', '1016': '霜冻', '1017': '大雾', '1018': '低空风切变', '1019': '霾', '1020': '雷雨大风', '1021': '道路结冰', '1022': '干旱', '1023': '海上大风', '1024': '中暑', '1025': '森林火灾', '1026': '草原火灾', '1027': '冰冻', '1028': '空间天气', '1029': '重污染', '1030': '低温雨雪', '1031': '强对流', '1032': '臭氧', '1033': '大雪', '1034': '寒冷', '1035': '连阴雨', '1036': '内涝', '1037': '地质灾害', '1038': '强降雨', '1039': '剧烈降温', '1040': '雪灾', '1043': '雷暴', '1201': '洪水', '1214': '山洪', '1241': '滑坡', '1242': '泥石流', '1271': '空气污染',
};
const EVENT_ALIASES: Record<string, string> = { rainstorm: '暴雨', heavyRain: '暴雨', gale: '大风', strongWind: '大风', snowStorm: '暴雪', coldWave: '寒潮', heatWave: '热浪', heavyFog: '大雾', sandstorm: '沙尘暴', thunderstorms: '雷暴', heavySnow: '暴雪', highTemperature: '高温', lowTemperature: '低温' };

export function normalizeWeather(raw: RawWeather): Weather {
  const code = String(raw.condition?.code ?? '999');
  return {
    conditionCode: code, condition: CONDITIONS[code] ?? '未知', temperature: raw.temperature?.value,
    feelsLike: raw.feelsLike?.value, humidity: raw.humidity, windScale: raw.wind?.scale,
    windDirection: DIRECTIONS[raw.wind?.direction?.compass ?? ''],
    precipitationType: raw.precipitation?.type, precipitationIntensity: raw.precipitation?.intensity?.value,
    precipitationAmount: raw.precipitation?.amount?.value, precipitationProbability: raw.precipitation?.probability,
    visibilityKm: raw.visibility?.value === undefined ? undefined : raw.visibility.value / 1000, uv: raw.uvIndex,
  };
}
export function normalizeAlert(raw: RawAlert): Alert {
  return {
    id: raw.id, event: EVENT_CODES[raw.eventType.code] ?? EVENTS[raw.eventType.name.toLowerCase()] ?? Object.entries(EVENT_ALIASES).find(([name]) => name.toLowerCase() === raw.eventType.name.toLowerCase().replace(/[ -]/g, ''))?.[1] ?? '气象', severity: raw.severity,
    color: raw.color?.code, urgency: raw.urgency, certainty: raw.certainty,
    issuedAt: raw.issuedTime, effectiveAt: raw.effectiveTime, onsetAt: raw.onsetTime, expiresAt: raw.expireTime,
    kind: raw.messageType.code, supersedes: raw.messageType.supersedes ?? [],
  };
}
export function apiBase(host: string): string {
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.qweatherapi\.com$/i.test(host) || host.includes('..')) throw new Error('API Host 须为控制台提供的 qweatherapi.com 主机名');
  return `https://${host}`;
}

export class QWeather {
  rawAlerts: RawAlert[] = [];
  attributions = new Set<string>();
  constructor(private readonly cfg: RealtimeWeatherConfigSection, private readonly secret: () => string, private readonly request: typeof fetch = fetch) {}

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const base = apiBase(this.cfg.apiHost.trim());
    const key = this.secret();
    if (!key) throw new Error('密钥未配置');
    let response: Response;
    try {
      response = await this.request(`${base}${path}`, {
        headers: { 'X-QW-Api-Key': key }, redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
      });
    } catch { throw new Error('QWeather 请求未完成'); }
    if (!response.ok) throw new Error(`QWeather HTTP ${response.status}`);
    let result: T & { metadata?: Metadata };
    try { result = await response.json() as T & { metadata?: Metadata }; }
    catch { throw new Error('QWeather 响应格式错误'); }
    for (const attribution of result.metadata?.attributions ?? []) this.attributions.add(attribution);
    return result;
  }
  private point(): string {
    const location = this.cfg.location;
    if (!location) throw new Error('尚未选择城市或区划');
    return `${location.latitude}/${location.longitude}`;
  }
  async current(signal?: AbortSignal): Promise<Weather> {
    return normalizeWeather(await this.get<RawWeather>(`/weather/v1/current/${this.point()}?lang=zh`, signal));
  }
  async hourly(signal?: AbortSignal): Promise<Hour[]> {
    const result = await this.get<{ hours: (RawWeather & { forecastTime: string })[] }>(`/weather/v1/hourly/${this.point()}?hours=3&lang=zh`, signal);
    return result.hours.map(h => ({ ...normalizeWeather(h), at: h.forecastTime }));
  }
  async daily(signal?: AbortSignal): Promise<Day[]> {
    const result = await this.get<{ days: RawDay[] }>(`/weather/v1/daily/${this.point()}?days=${this.cfg.forecastDays}&lang=zh`, signal);
    return result.days.map(d => ({ date: new Intl.DateTimeFormat('en-CA', { timeZone: this.cfg.location!.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d.forecastStartTime)), daytime: normalizeWeather(d.daytime), nighttime: normalizeWeather(d.nighttime), min: d.temperatureMin?.value, max: d.temperatureMax?.value, uv: d.uvIndexMax }));
  }
  async air(at: string, signal?: AbortSignal): Promise<Air> {
    const result = await this.get<{ indexes: { code: string; aqiDisplay: string; level: string; category: string; primaryPollutant?: { code: string } }[]; pollutants: { code: string; concentration: Value }[] }>(`/airquality/v1/current/${this.point()}?lang=zh`, signal);
    const index = result.indexes.find(i => i.code !== 'qaqi') ?? result.indexes.find(i => i.code === 'qaqi');
    if (!index) throw new Error('空气质量暂无数据');
    const category = airCategory(index.code, Number(index.level));
    return { at, standard: index.code, value: index.aqiDisplay, level: Number(index.level), category, primary: POLLUTANTS[index.primaryPollutant?.code ?? ''], pm25: result.pollutants.find(p => p.code === 'pm2p5')?.concentration.value };
  }
  async alerts(signal?: AbortSignal): Promise<Alert[]> {
    const result = await this.get<{ alerts: RawAlert[] }>(`/weatheralert/v1/current/${this.point()}?lang=zh`, signal);
    this.rawAlerts = result.alerts;
    return result.alerts.map(normalizeAlert);
  }
  async cities(query: string, filters: { adm?: string; range?: string } = {}, signal?: AbortSignal): Promise<Location[]> {
    const params = new URLSearchParams({ location: query, number: '20', lang: 'zh' });
    if (filters.adm?.trim()) params.set('adm', filters.adm.trim());
    if (filters.range?.trim()) params.set('range', filters.range.trim().toLowerCase());
    const result = await this.get<{ code: string; location?: { id: string; name: string; country: string; adm1: string; adm2: string; lat: string; lon: string; tz: string }[] }>(`/geo/v2/city/lookup?${params}`, signal);
    if (result.code !== '200') throw new Error(`城市搜索：${/^\d{3}$/.test(result.code) ? result.code : '响应错误'}`);
    return (result.location ?? []).map(l => ({ id: l.id, name: l.name, country: l.country, province: l.adm1, city: l.adm2, latitude: Number(l.lat), longitude: Number(l.lon), timezone: l.tz }));
  }
}
