import { describe, expect, it } from 'vitest';
import { clock, dateKey, isDaylight, solarTimes, nextDailyForecastAt } from '../src/time.ts';
import type { Location } from '../src/config.ts';
const location: Location = { name: 'Example', country: 'Example', province: '', city: '', latitude: -34, longitude: 151, timezone: 'Australia/Sydney' };
describe('部署时区与天文', () => {
  it.each([
    ['2026-10-30T20:59:00Z', 'Australia/Sydney', '2026-10-30T21:00:00Z'],
    ['2026-10-30T21:00:00Z', 'Australia/Sydney', '2026-10-31T21:00:00Z'],
    ['2026-10-02T22:00:00Z', 'Australia/Sydney', '2026-10-03T21:00:00Z'],
    ['2026-04-03T21:00:00Z', 'Australia/Sydney', '2026-04-04T22:00:00Z'],
    ['2026-10-31T02:00:00Z', 'Asia/Kathmandu', '2026-10-31T02:15:00Z'],
  ])('每日08:00按时区重算：%s %s', (now, timezone, expected) => {
    expect(nextDailyForecastAt(Date.parse(now), timezone)).toBe(Date.parse(expected));
  });
  it('按地点时区跨日期，并应用夏令时', () => {
    expect(clock('2026-10-31T14:15:00Z', 'Australia/Sydney')).toBe('01:15');
    expect(dateKey('2026-10-31T14:15:00Z', 'Australia/Sydney')).toBe('2026-11-01');
    expect(clock('2026-06-01T14:15:00Z', 'Australia/Sydney')).toBe('00:15');
  });
  it('日出日落落在配置地点当天，昼夜由太阳位置判断', () => {
    const now = Date.parse('2026-10-31T02:00:00Z');
    const times = solarTimes(now, location, 'Australia/Sydney');
    expect(dateKey(times.sunrise!, 'Australia/Sydney')).toBe('2026-10-31');
    expect(dateKey(times.sunset!, 'Australia/Sydney')).toBe('2026-10-31');
    expect(times.sunrise!.getTime()).toBeLessThan(times.sunset!.getTime());
    expect(isDaylight(now, location)).toBe(true);
    expect(isDaylight(Date.parse('2026-10-31T14:00:00Z'), location)).toBe(false);
  });
  it('极昼没有日出日落，允许调度下一次重算', () => {
    const times = solarTimes(Date.parse('2026-06-21T12:00:00Z'), { ...location, latitude: 80, longitude: 0 }, 'UTC');
    expect(times.sunrise).toBeNull(); expect(times.sunset).toBeNull(); expect(times.alwaysUp).toBe(true);
  });
});
