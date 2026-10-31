import { describe, expect, it } from 'vitest';
import { forecastTags } from '../src/forecast.ts';
import { forecastLines } from '../src/format.ts';
import { REALTIME_WEATHER_DEFAULTS } from '../src/config.ts';
import type { Day, Forecast, Weather } from '../src/model.ts';

const clear: Weather = { conditionCode: '100', condition: '晴', temperature: 22, precipitationType: 'none', precipitationProbability: 0.1, windScale: 2 };
const day = (date: string, overrides: Partial<Day> = {}): Day => ({ date, min: 18, max: 25, daytime: clear, nighttime: { ...clear, conditionCode: '151', condition: '多云' }, ...overrides });
const snapshot = (overrides: Partial<Forecast> = {}): Forecast => ({ at: '2026-10-31T10:00:00Z', hours: [11, 12, 13].map(hour => ({ ...clear, at: `2026-10-31T${hour}:00:00Z` })), days: [day('2026-10-31'), day('2026-11-01'), day('2026-11-02')], errors: {}, ...overrides });
const tags = (f: Forecast) => forecastTags(f, clear, REALTIME_WEATHER_DEFAULTS, 'UTC');
describe('预报文案范围', () => {
  it('连续逐日升温才使用一路上涨，短暂转暖不匹配', () => {
    const f = snapshot({ days: [day('2026-10-31'), day('2026-11-01', { min: 19, max: 26 }), day('2026-11-02', { min: 21, max: 28 }), day('2026-11-03', { min: 23, max: 30 })] });
    expect(tags(f)).toEqual(expect.arrayContaining(['forecastDailyWarm', 'forecastDailyWarmFromTomorrow']));
    f.days[2].max = 24;
    expect(tags(f)).not.toContain('forecastDailyWarm');
  });
  it.each([
    [{ windScale: 2 }, { windScale: 5 }, 'forecastWindUp'],
    [{ windScale: 5 }, { windScale: 2 }, 'forecastWindDown'],
    [{ visibilityKm: 8 }, { visibilityKm: 0.5 }, 'forecastVisibilityDown'],
    [{ visibilityKm: 0.5 }, { visibilityKm: 8 }, 'forecastVisibilityUp'],
    [{ uv: 2 }, { uv: 8 }, 'forecastUvUp'], [{ uv: 8 }, { uv: 2 }, 'forecastUvDown'],
    [{ conditionCode: '307', precipitationType: 'rain' }, { conditionCode: '305', precipitationType: 'rain' }, 'forecastRainWeaker'],
    [{ conditionCode: '307', precipitationType: 'rain' }, { precipitationType: 'none' }, 'forecastRainStopped'],
    [{ precipitationType: 'none' }, { conditionCode: '400', precipitationType: 'snow' }, 'forecastSnowStarted'],
    [{ conditionCode: '400', precipitationType: 'snow' }, { conditionCode: '402', precipitationType: 'snow' }, 'forecastSnowStronger'],
    [{ conditionCode: '403', precipitationType: 'snow' }, { conditionCode: '400', precipitationType: 'snow' }, 'forecastSnowWeaker'],
    [{ conditionCode: '400', precipitationType: 'snow' }, { precipitationType: 'none' }, 'forecastSnowStopped'],
  ] as const)('预报趋势%j→%j匹配%s', (before, after, expected) => {
    const f = snapshot({ days: [] });
    f.hours = f.hours.slice(0, 1).map(h => ({ ...h, ...after }));
    expect(forecastTags(f, { ...clear, ...before }, REALTIME_WEATHER_DEFAULTS, 'UTC')).toContain(expected);
  });
  it('预报修订方向不能替代未来变化方向，风预报改强但仍弱于当前时使用减弱句', () => {
    const f = snapshot({ days: [] }); f.hours[0].windScale = 5;
    const result = forecastTags(f, { ...clear, windScale: 8 }, REALTIME_WEATHER_DEFAULTS, 'UTC', { hours: new Map([[f.hours[0].at, [{ id: 'windUp', text: '' }]]]), days: new Map() });
    expect(result).toContain('forecastWindDown'); expect(result).not.toContain('forecastWindUp');
    const unrelated = forecastTags(f, { ...clear, windScale: 8 }, REALTIME_WEATHER_DEFAULTS, 'UTC', { hours: new Map([[f.hours[0].at, [{ id: 'uvUp', text: '' }]]]), days: new Map() });
    expect(unrelated).not.toContain('forecastWindDown');
  });
  it('连续晴天只看未来多日，夜间多云不否定晴天；多日失败不由逐时推断', () => {
    expect(tags(snapshot())).toContain('forecastClear');
    expect(tags(snapshot({ days: [], errors: { days: '不可用' } }))).not.toContain('forecastClear');
    const rain = { ...clear, conditionCode: '305', condition: '小雨', precipitationType: 'rain' };
    expect(tags(snapshot({ days: [day('2026-11-01', { daytime: rain }), day('2026-11-02', { nighttime: rain })] }))).toContain('forecastWet');
  });
  it('逐日冷暖使用独立标签，不套近期文案', () => {
    const dailyCold = tags(snapshot({ days: [day('2026-10-31'), day('2026-11-01', { min: 15, max: 22 })] }));
    expect(dailyCold).toContain('forecastDailyCold');
    expect(dailyCold).not.toContain('forecastCold');
    const warm = tags(snapshot({ days: [day('2026-10-31'), day('2026-11-01', { min: 21, max: 28 })] }));
    expect(warm).not.toContain('forecastDailyWarm'); expect(warm).not.toContain('forecastWarm');
  });
  it('平稳与温和文案有完整逐时数据和当前温度依据', () => {
    expect(tags(snapshot({ days: [] }))).toEqual(expect.arrayContaining(['forecastStable', 'forecastMild']));
    expect(tags(snapshot({ days: [], hours: [] }))).not.toContain('forecastStable');
    expect(forecastTags(snapshot({ days: [] }), undefined, REALTIME_WEATHER_DEFAULTS, 'UTC')).not.toContain('forecastStable');
  });
  it('未覆盖时段明确显示暂无预报', () => {
    expect(forecastLines(snapshot({ hours: [], days: [] }), 'UTC')).toContain('未来第1、2小时暂无预报');
    expect(forecastLines(snapshot({ hours: [] }), 'UTC')).not.toContain('11:00｜');
  });
});
