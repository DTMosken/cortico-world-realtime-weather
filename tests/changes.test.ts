import { describe, expect, it } from 'vitest';
import { activeAlerts, alertChanges, weatherChanges } from '../src/changes.ts';
import { REALTIME_WEATHER_DEFAULTS } from '../src/config.ts';
import type { Alert, Weather } from '../src/model.ts';
const base: Weather = { conditionCode: '100', condition: '晴', temperature: 22, feelsLike: 22, precipitationType: 'none', visibilityKm: 8, uv: 2, windScale: 2 };
describe('双向变化', () => {
  it.each([
    [{ visibilityKm: 0.5 }, 'visibilityDown'], [{ visibilityKm: 0.5, uv: 8 }, 'uvUp'], [{ windScale: 5 }, 'windUp'],
  ] as const)('达到阈值产生事件：%j', (next, id) => { expect(weatherChanges(base, { ...base, ...next }, REALTIME_WEATHER_DEFAULTS).changes.map(c => c.id)).toContain(id); });
  it('能见度恢复和UV降低同样产生事件', () => {
    const result = weatherChanges({ ...base, visibilityKm: 0.5, uv: 8 }, base, REALTIME_WEATHER_DEFAULTS);
    expect(result.changes.map(c => c.id)).toEqual(expect.arrayContaining(['visibilityUp', 'uvDown']));
  });
  it('预警更新关联旧消息，取消消息只通知一次', () => {
    const old: Alert = { id: 'a', event: '大风', severity: 'severe', kind: 'alert', supersedes: [] };
    const next: Alert = { ...old, id: 'b', severity: 'minor', kind: 'update', supersedes: ['a'] };
    expect(alertChanges([old], [next], 0).map(c => c.id)).toEqual(['alertDowngraded']);
    const cancel: Alert = { ...next, id: 'c', kind: 'cancel', supersedes: ['b'] };
    expect(alertChanges([next], [cancel], 0).map(c => c.id)).toEqual(['alertCancelled']);
    expect(alertChanges([cancel], [cancel], 0)).toEqual([]); expect(alertChanges([cancel], [], 0)).toEqual([]);
    expect(activeAlerts([cancel], 0)).toEqual([]);
  });
  it.each([['100', '150'], ['101', '151'], ['300', '350'], ['406', '456']])('昼夜代码%s/%s不产生虚假变化', (day, night) => {
    expect(weatherChanges({ ...base, conditionCode: day }, { ...base, conditionCode: night }, REALTIME_WEATHER_DEFAULTS).changes).toEqual([]);
  });
  it('雪停转阴不描述成晴转阴，雨雪切换使用专属变化', () => {
    const snow = { ...base, conditionCode: '400', condition: '小雪', precipitationType: 'snow' };
    expect(weatherChanges(snow, { ...base, conditionCode: '104', condition: '阴' }, REALTIME_WEATHER_DEFAULTS).changes.map(c => c.id)).toEqual(['conditionChanged', 'snowStopped']);
    expect(weatherChanges({ ...base, precipitationType: 'rain' }, snow, REALTIME_WEATHER_DEFAULTS).changes.map(c => c.id)).toContain('rainToSnow');
    expect(weatherChanges(snow, { ...base, precipitationType: 'rain' }, REALTIME_WEATHER_DEFAULTS).changes.map(c => c.id)).toContain('snowToRain');
  });
  it.each(['315', '308', '318'])('小雨转%s无强度字段时仍识别增强', code => {
    expect(weatherChanges({ ...base, conditionCode: '305', precipitationType: 'rain' }, { ...base, conditionCode: code, precipitationType: 'rain' }, REALTIME_WEATHER_DEFAULTS).changes.map(c => c.id)).toContain('rainStronger');
  });
  it('阵雨类型本身不当作零强度，存在强度时识别其变化', () => {
    const rain = { ...base, conditionCode: '305', precipitationType: 'rain' };
    expect(weatherChanges(rain, { ...rain, conditionCode: '302' }, REALTIME_WEATHER_DEFAULTS).changes.map(c => c.id)).not.toContain('rainWeaker');
    expect(weatherChanges({ ...rain, conditionCode: '300', precipitationIntensity: 1 }, { ...rain, conditionCode: '300', precipitationIntensity: 9 }, REALTIME_WEATHER_DEFAULTS).changes.map(c => c.id)).toContain('rainStronger');
  });
  it('忽略未知前序取消与同批已被取代的消息，区分升级和普通更新', () => {
    const old: Alert = { id: 'a', event: '寒潮', severity: 'moderate', color: 'yellow', kind: 'alert', supersedes: [] };
    const next: Alert = { ...old, id: 'b', color: 'orange', kind: 'update', supersedes: ['a'] };
    const cancel: Alert = { ...next, id: 'c', kind: 'cancel', supersedes: ['b'] };
    expect(alertChanges([], [cancel], 0)).toEqual([]);
    expect(alertChanges([], [old, next, cancel], 0)).toEqual([]);
    expect(alertChanges([old], [next, cancel], 0).map(c => c.id)).toEqual(['alertCancelled']);
    expect(activeAlerts([old, next], 0)).toEqual([next]);
    expect(alertChanges([old], [old, next], 0).map(c => c.id)).toEqual(['alertUpgraded']);
    expect(alertChanges([old], [{ ...next, color: 'yellow' }], 0).map(c => c.id)).toEqual(['alertUpdated']);
  });
});
