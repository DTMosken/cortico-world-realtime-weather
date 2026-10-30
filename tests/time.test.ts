import { describe, expect, it } from 'vitest';
import { clock, dateKey, isDaylight, solarTimes } from '../src/time.ts';
import type { Location } from '../src/config.ts';
const location: Location = { id: 'sample', name: 'Example', country: 'Example', province: '', city: '', latitude: -34, longitude: 151, timezone: 'Australia/Sydney' };
describe('配置地点时间与天文', () => {
  it('按地点时区跨日期，并应用夏令时', () => {
    expect(clock('2026-10-31T14:15:00Z', location.timezone)).toBe('01:15');
    expect(dateKey('2026-10-31T14:15:00Z', location.timezone)).toBe('2026-11-01');
    expect(clock('2026-06-01T14:15:00Z', location.timezone)).toBe('00:15');
  });
  it('日出日落落在配置地点当天，昼夜由太阳位置判断', () => {
    const now = Date.parse('2026-10-31T02:00:00Z');
    const times = solarTimes(now, location);
    expect(dateKey(times.sunrise!, location.timezone)).toBe('2026-10-31');
    expect(dateKey(times.sunset!, location.timezone)).toBe('2026-10-31');
    expect(times.sunrise!.getTime()).toBeLessThan(times.sunset!.getTime());
    expect(isDaylight(now, location)).toBe(true);
    expect(isDaylight(Date.parse('2026-10-31T14:00:00Z'), location)).toBe(false);
  });
  it('极昼没有日出日落，允许调度下一次重算', () => {
    const times = solarTimes(Date.parse('2026-06-21T12:00:00Z'), { ...location, latitude: 80, longitude: 0, timezone: 'UTC' });
    expect(times.sunrise).toBeNull(); expect(times.sunset).toBeNull(); expect(times.alwaysUp).toBe(true);
  });
});
