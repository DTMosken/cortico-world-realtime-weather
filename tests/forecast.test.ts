import { describe, expect, it } from 'vitest';
import { forecastTags } from '../src/forecast.ts';
import { forecastLines } from '../src/format.ts';
import { REALTIME_WEATHER_DEFAULTS } from '../src/config.ts';
import type { Day, Forecast, Weather } from '../src/model.ts';

const clear: Weather = { conditionCode: '100', condition: '晴', temperature: 22, precipitationType: 'none', precipitationProbability: 0.1, windScale: 2 };
const day = (date: string, overrides: Partial<Day> = {}): Day => ({ date, min: 18, max: 25, daytime: clear, nighttime: { ...clear, conditionCode: '151', condition: '多云' }, ...overrides });
const snapshot = (overrides: Partial<Forecast> = {}): Forecast => ({ at: '2026-10-31T10:00:00Z', hours: [11, 12, 13].map(hour => ({ ...clear, at: `2026-10-31T${hour}:00:00Z` })), days: [day('2026-10-31'), day('2026-11-01'), day('2026-11-02')], errors: {}, ...overrides });
const tags = (f: Forecast) => forecastTags(f, clear, REALTIME_WEATHER_DEFAULTS.temperatureChange, 'UTC');
describe('预报文案范围', () => {
  it('连续晴天只看未来多日，夜间多云不否定晴天；多日失败不由逐时推断', () => {
    expect(tags(snapshot())).toContain('forecastClear');
    expect(tags(snapshot({ days: [], errors: { days: '不可用' } }))).not.toContain('forecastClear');
    const rain = { ...clear, conditionCode: '305', condition: '小雨', precipitationType: 'rain' };
    expect(tags(snapshot({ days: [day('2026-11-01', { daytime: rain }), day('2026-11-02', { nighttime: rain })] }))).toContain('forecastWet');
  });
  it('逐日极值跨阈值选降温，逐日升温保留单独标签以免称为待会儿', () => {
    expect(tags(snapshot({ days: [day('2026-10-31'), day('2026-11-01', { min: 15, max: 22 })] }))).toContain('forecastCold');
    const warm = tags(snapshot({ days: [day('2026-10-31'), day('2026-11-01', { min: 21, max: 28 })] }));
    expect(warm).toContain('forecastDailyWarm'); expect(warm).not.toContain('forecastWarm');
  });
  it('平稳与温和文案有完整逐时数据和当前温度依据', () => {
    expect(tags(snapshot({ days: [] }))).toEqual(expect.arrayContaining(['forecastStable', 'forecastMild']));
    expect(tags(snapshot({ days: [], hours: [] }))).not.toContain('forecastStable');
    expect(forecastTags(snapshot({ days: [] }), undefined, 3, 'UTC')).not.toContain('forecastStable');
  });
  it('未覆盖时段明确显示暂无预报', () => {
    expect(forecastLines(snapshot({ hours: [], days: [] }), 'UTC')).toContain('未来第1、2小时暂无预报');
    expect(forecastLines(snapshot({ hours: [] }), 'UTC')).not.toContain('11:00｜');
  });
});
