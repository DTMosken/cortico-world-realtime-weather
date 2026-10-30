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
});
