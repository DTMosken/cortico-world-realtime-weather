import { describe, expect, it } from 'vitest';
import { clock, dateKey, period, isDaylight, solarTimes, nextDailyForecastAt } from '../src/time.ts';
import type { Location } from '../src/config.ts';
const location: Location = { name: 'Example', country: 'Example', province: '', city: '', latitude: -34, longitude: 151, timezone: 'Australia/Sydney' };
describe('地点时区与天文', () => {
  it('清晨自民用晨光开始与05:00中较早者至地点日出，冬季08点日出前仍为清晨', () => {
    const zone = location.timezone;
    const times = solarTimes(Date.parse('2026-10-31T06:00:00Z'), location, zone);
    expect(period(times.sunrise!.getTime() - 1, zone, location)).toBe('morning');
    expect(period(times.sunrise!, zone, location)).toBe('day');
    const beijing = { ...location, latitude: 39.9, longitude: 116.4, timezone: 'Asia/Shanghai' };
    const summer = solarTimes(Date.parse('2026-06-21T04:00:00Z'), beijing, beijing.timezone);
    expect(clock(summer.dawn!, beijing.timezone) < '05:00').toBe(true);
    expect(period(summer.dawn!, beijing.timezone, beijing)).toBe('morning');
    expect(period(summer.dawn!.getTime() - 1, beijing.timezone, beijing)).toBe('lateNight');
    expect(period('2026-06-21T00:00:00Z', beijing.timezone, beijing)).toBe('day');
    const helsinki = { ...location, latitude: 60.17, longitude: 24.94, timezone: 'Europe/Helsinki' };
    expect(period('2026-12-21T02:30:00Z', helsinki.timezone, helsinki)).toBe('lateNight');
    expect(period('2026-12-21T06:30:00Z', helsinki.timezone, helsinki)).toBe('morning');
    const polar = { ...location, latitude: 80, longitude: 0, timezone: 'UTC' };
    expect(period('2026-06-21T06:00:00Z', 'UTC', polar)).toBe('morning');
    expect(period('2026-12-21T06:00:00Z', 'UTC', polar)).toBe('morning');
  });

  it('暮色使用地点日落至民用暮光结束，夏季17点仍为日间', () => {
    const zone = location.timezone;
    const at = Date.parse('2026-10-31T06:00:00Z');
    const times = solarTimes(at, location, zone);
    expect(period(at, zone, location)).toBe('day');
    expect(period(times.sunset!.getTime() - 1, zone, location)).toBe('day');
    expect(period(times.sunset!, zone, location)).toBe('evening');
    expect(period(times.dusk!, zone, location)).toBe('night');
    const polar = { ...location, latitude: 80, longitude: 0, timezone: 'UTC' };
    expect(period('2026-06-21T18:00:00Z', 'UTC', polar)).toBe('day');
    expect(period('2026-12-21T18:00:00Z', 'UTC', polar)).toBe('night');
  });
  it('白夜没有民用暮光结束时，日落至23:30为傍晚', () => {
    const tampere = { ...location, latitude: 61.5, longitude: 23.76, timezone: 'Europe/Helsinki' };
    const times = solarTimes(Date.parse('2026-06-21T12:00:00Z'), tampere, tampere.timezone);
    expect(times.dusk).toBeNull();
    expect(clock(times.sunset!, tampere.timezone) < '23:30').toBe(true);
    expect(period(times.sunset!, tampere.timezone, tampere)).toBe('evening');
    expect(period('2026-06-21T20:29:00Z', tampere.timezone, tampere)).toBe('evening');
    expect(period('2026-06-21T20:30:00Z', tampere.timezone, tampere)).toBe('lateNight');
  });
  it('午夜后仍未结束的上一日日间与傍晚按上一日日落与民用暮光结束', () => {
    const helsinki = { ...location, latitude: 60.17, longitude: 24.94, timezone: 'Europe/Helsinki' };
    expect(period('2026-06-20T21:20:00Z', helsinki.timezone, helsinki)).toBe('evening');
    expect(period('2026-06-20T21:50:00Z', helsinki.timezone, helsinki)).toBe('lateNight');
    const reykjavik = { ...location, latitude: 64.1466, longitude: -21.9426, timezone: 'Atlantic/Reykjavik' };
    expect(period('2026-06-21T00:01:00Z', reykjavik.timezone, reykjavik)).toBe('day');
    expect(period('2026-06-21T00:05:00Z', reykjavik.timezone, reykjavik)).toBe('lateNight');
    const bergen = { ...location, latitude: 60.39, longitude: 5.32, timezone: 'Europe/Oslo' };
    expect(period('2026-06-01T22:15:00Z', bergen.timezone, bergen)).toBe('evening');
    expect(period('2026-06-01T22:25:00Z', bergen.timezone, bergen)).toBe('lateNight');
  });

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
