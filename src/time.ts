import { getPosition, getTimes } from 'suncalc';
import type { Location } from './config.ts';

export function clock(at: string | number | Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
}
export function dateKey(at: string | number | Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}
export function period(at: string | number | Date, timezone: string): string {
  const [hour, minute] = clock(at, timezone).split(':').map(Number);
  const minutes = hour * 60 + minute;
  return minutes >= 300 && minutes < 480 ? 'morning' : minutes >= 480 && minutes < 1020 ? 'day' : minutes >= 1020 && minutes < 1170 ? 'evening' : minutes >= 1170 && minutes < 1410 ? 'night' : 'lateNight';
}
export function solarTimes(at: number, location: Location) {
  const offsetText = new Intl.DateTimeFormat('en', { timeZone: location.timezone, timeZoneName: 'longOffset' }).formatToParts(at).find(p => p.type === 'timeZoneName')!.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetText);
  const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : 0;
  return getTimes(new Date(at), location.latitude, location.longitude, 0, offsetMinutes);
}
export function isDaylight(at: number, location: Location): boolean {
  return getPosition(new Date(at), location.latitude, location.longitude).altitude >= -0.833;
}
