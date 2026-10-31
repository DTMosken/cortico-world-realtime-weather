export interface Weather {
  conditionCode: string;
  condition: string;
  temperature?: number;
  feelsLike?: number;
  humidity?: number;
  windScale?: number;
  windDirection?: string;
  precipitationType?: string;
  precipitationIntensity?: number;
  precipitationAmount?: number;
  precipitationProbability?: number;
  visibilityKm?: number;
  uv?: number;
}
export interface Hour extends Weather { at: string }
export interface Day {
  date: string;
  daytime: Weather;
  nighttime: Weather;
  min?: number;
  max?: number;
  uv?: number;
}
export interface Air {
  at: string;
  standard: string;
  value: string;
  level: number;
  category: string;
  primary?: string;
}
export interface Alert {
  id: string;
  event: string;
  severity: string;
  color?: string;
  effectiveAt?: string;
  onsetAt?: string;
  expiresAt?: string;
  kind: string;
  supersedes: string[];
}
export interface Current {
  at: string;
  weather?: Weather;
  air?: Air;
  alerts: Alert[];
  weatherAt?: string;
  alertsAt?: string;
  errors: Partial<Record<'weather' | 'air' | 'alerts', string>>;
}
export interface Forecast {
  at: string;
  hours: Hour[];
  days: Day[];
  hoursAt?: string;
  daysAt?: string;
  errors: Partial<Record<'hours' | 'days', string>>;
}
export interface Change { id: string; text: string; alertType?: string }

export function uvLevel(value: number): number {
  return value < 3 ? 0 : value < 6 ? 1 : value < 8 ? 2 : value < 11 ? 3 : 4;
}
export const UV_NAMES = ['低', '中等', '高', '很高', '极高'];
export function alertGrade(alert: Alert): string {
  const colors: Record<string, string> = { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色', green: '绿色', white: '白色', black: '黑色', amber: '琥珀色', purple: '紫色', gray: '灰色' };
  const severity: Record<string, string> = { extreme: '极端', severe: '严重', moderate: '中等', minor: '轻微' };
  return colors[alert.color ?? ''] ?? severity[alert.severity] ?? '';
}

export function conditionCode(code: string): string {
  return ({ '150': '100', '151': '101', '152': '102', '153': '103', '350': '300', '351': '301', '456': '406', '457': '407' } as Record<string, string>)[code] ?? code;
}

export function weatherTags(w: Weather): string[] {
  const code = Number(w.conditionCode);
  const tags: string[] = [];
  if (code === 100 || code === 150) tags.push('clear');
  else if (code >= 101 && code <= 104 || code >= 151 && code <= 153) tags.push('cloudy');
  if (w.precipitationType === 'rain') {
    tags.push('rain');
    if (w.precipitationIntensity !== undefined) tags.push(w.precipitationIntensity < 2.5 ? 'lightRain' : 'heavyRain');
    else if ([305, 309].includes(code)) tags.push('lightRain');
    else if ([307, 308, 310, 311, 312, 316, 317, 318].includes(code)) tags.push('heavyRain');
  }
  if (w.precipitationType === 'snow') {
    tags.push('snow');
    if ([402, 403, 409, 410].includes(code)) tags.push('heavySnow');
    if ([400, 408].includes(code)) tags.push('lightSnow');
  }
  if (w.precipitationType === 'mixed') tags.push('mixed');
  if ([302, 303, 304].includes(code)) tags.push('thunder');
  if ([500, 501, 509, 510, 514, 515].includes(code) && w.visibilityKm !== undefined && w.visibilityKm < 2) tags.push('fog');
  if ([502, 511, 512, 513].includes(code)) tags.push('haze');
  if (code === 500 && w.visibilityKm !== undefined && w.visibilityKm >= 2) tags.push('thinFog');
  if (code === 502) tags.push('lightHaze');
  if ([503, 504].includes(code)) tags.push('lightDust');
  if ([503, 504, 507, 508].includes(code)) tags.push('dust');
  if ((w.windScale ?? 0) >= 5) tags.push('windy');
  if ((w.feelsLike ?? Infinity) < 0) tags.push('freezing');
  if ((w.temperature ?? -Infinity) > 32) tags.push('hot');
  if ((w.humidity ?? 0) > 0.8 && (w.temperature ?? 0) >= 28) tags.push('humidHot');
  return tags;
}
