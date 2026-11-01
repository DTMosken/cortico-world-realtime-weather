import type { ConfigGroup } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';

export interface Location {
  name: string;
  country: string;
  province: string;
  city: string;
  latitude: number;
  longitude: number;
  /** 天气地点的IANA时区，选择城市时取自GeoAPI。 */
  timezone: string;
}
/** 城市搜索结果；id仅用于本次选择，不写入配置。 */
export interface CityCandidate extends Location { id: string }

export interface RealtimeWeatherConfigSection {
  enabled: boolean;
  apiHost: string;
  location: Location | null;
  forecastDays: number;
  temperatureChange: number;
  windScaleChange: number;
  visibilityThresholdKm: number;
  precipitationProbabilityChange: number;
}

export const REALTIME_WEATHER_SECRET = 'CORTICO_QWEATHER_API_KEY';
export const REALTIME_WEATHER_DEFAULTS: RealtimeWeatherConfigSection = {
  enabled: false, apiHost: '', location: null, forecastDays: 7,
  temperatureChange: 3, windScaleChange: 2, visibilityThresholdKm: 1,
  precipitationProbabilityChange: 30,
};

export function realtimeWeatherConfigGroup(_language?: Language): ConfigGroup {
  return {
    id: 'world:realtime-weather', owner: 'world:realtime-weather',
    schema: { type: 'object', title: '实时天气', properties: {
      'worlds.realtime-weather.apiHost': { type: 'string', title: 'QWeather API Host', 'x-hot': true },
      'worlds.realtime-weather.location': { type: 'object', title: '天气地点', 'x-hot': false },
      'worlds.realtime-weather.forecastDays': { type: 'integer', title: '预报天数', minimum: 1, maximum: 10, 'x-hot': true },
      'worlds.realtime-weather.temperatureChange': { type: 'number', title: '温度变化阈值', minimum: 0.1, 'x-suffix': '°C', 'x-hot': true },
      'worlds.realtime-weather.windScaleChange': { type: 'integer', title: '风力变化阈值', minimum: 1, 'x-suffix': '级', 'x-hot': true },
      'worlds.realtime-weather.visibilityThresholdKm': { type: 'number', title: '低能见度阈值', minimum: 0.1, 'x-suffix': 'km', 'x-hot': true },
      'worlds.realtime-weather.precipitationProbabilityChange': { type: 'number', title: '降水概率变化阈值', minimum: 1, maximum: 100, 'x-suffix': '个百分点', 'x-hot': true },
    } },
  };
}
