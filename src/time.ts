import { getPosition, getTimes } from 'suncalc';
import type { Location } from './config.ts';

export function clock(at: string | number | Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
}
export function dateKey(at: string | number | Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}
export function period(at: string | number | Date, timezone: string, location?: Location): string {
  const [hour, minute] = clock(at, timezone).split(':').map(Number);
  const minutes = hour * 60 + minute;
  if (location) {
    const now = new Date(at).getTime();
    const times = solarTimes(now, location, timezone);
    if (times.sunrise && times.sunset) {
      if (now < times.sunrise.getTime()) {
        // 上一日的日间与暮色可能延续到午夜后；以正午回推24小时取上一日，避开夏令时错位。
        const previous = solarTimes(times.solarNoon.getTime() - 24 * 60 * 60_000, location, timezone);
        if (previous.sunset && now < previous.sunset.getTime()) return 'day';
        if (previous.dusk && now < previous.dusk.getTime()) return 'evening';
        return minutes >= 300 || times.dawn && now >= times.dawn.getTime() ? 'morning' : 'lateNight';
      }
      if (now < times.sunset.getTime()) return 'day';
      // 白夜没有民用暮光结束，日落至23:30为傍晚。
      if (!times.dusk) return minutes < 1410 ? 'evening' : 'lateNight';
      if (now < times.dusk.getTime()) return 'evening';
      return minutes < 1410 ? 'night' : 'lateNight';
    }
    // 极昼极夜没有日出日落，08:00前沿用固定时段。
    if (minutes >= 480) return times.alwaysUp ? 'day' : minutes < 1410 ? 'night' : 'lateNight';
  }
  return minutes >= 300 && minutes < 480 ? 'morning' : minutes >= 480 && minutes < 1020 ? 'day' : minutes >= 1020 && minutes < 1170 ? 'evening' : minutes >= 1170 && minutes < 1410 ? 'night' : 'lateNight';
}
function offsetMinutes(at: number, timezone: string): number {
  const offsetText = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(at).find(p => p.type === 'timeZoneName')!.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetText);
  return match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : 0;
}
export function nextAlignedCheckAt(now: number, timezone: string, intervalMinutes: number): number {
  const localClock = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  // 时间线上逐分钟找当地刻度，夏令时跳过或重复的小时也按表盘计。
  for (let at = now - now % 60_000 + 60_000; at <= now + 2 * 24 * 60 * 60_000; at += 60_000) {
    const [hour, minute] = localClock.format(at).split(':').map(Number);
    if ((hour * 60 + minute) % intervalMinutes === 0) return at;
  }
  throw new Error('没有可用的检查时刻');
}
export function nextDailyForecastAt(now: number, timezone: string, time: string): number {
  const day = 24 * 60 * 60_000;
  const wall = Date.parse(`${dateKey(now, timezone)}T${time}:00Z`);
  for (let target = wall; target <= wall + 2 * day; target += day) {
    // 夏令时回拨时取第一次，跳过当天不存在的时刻。
    const before = offsetMinutes(target - day, timezone);
    const after = offsetMinutes(target + day, timezone);
    for (const offset of new Set([Math.max(before, after), Math.min(before, after)])) {
      const candidate = target - offset * 60_000;
      if (offsetMinutes(candidate, timezone) !== offset) continue;
      if (candidate > now) return candidate;
      break;
    }
  }
  throw new Error('没有可用的每日预报时刻');
}
export function solarTimes(at: number, location: Location, timezone: string) {
  return getTimes(new Date(at), location.latitude, location.longitude, 0, offsetMinutes(at, timezone));
}
export function isDaylight(at: number, location: Location): boolean {
  return getPosition(new Date(at), location.latitude, location.longitude).altitude >= -0.833;
}
