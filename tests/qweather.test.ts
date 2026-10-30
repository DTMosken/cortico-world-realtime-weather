import { describe, expect, it } from 'vitest';
import { apiBase, normalizeAlert, normalizeWeather } from '../src/qweather.ts';
describe('服务边界', () => {
  it.each(['http://example.qweatherapi.com', '127.0.0.1', 'example.qweatherapi.com/path', 'example.qweatherapi.com@other.example', 'example.qweatherapi.com.other.example', 'example..qweatherapi.com'])('拒绝非控制台主机名：%s', host => { expect(() => apiBase(host)).toThrow(); });
  it('空字段保持缺失，累计降水不视为当前雨量', () => {
    const result = normalizeWeather({ condition: { code: '100' }, precipitation: { type: 'none', amount: { value: 5 } } });
    expect(result.temperature).toBeUndefined(); expect(result.precipitationIntensity).toBeUndefined(); expect(result.precipitationType).toBe('none');
  });
  it('模型可见预警不包含原文、发布机构、地点或消息id之外的额外字段', () => {
    const result = normalizeAlert({ id: 'message', eventType: { name: 'wind', code: '1' }, severity: 'severe', messageType: { code: 'alert' }, headline: 'PRIVATE_CITY', description: 'PRIVATE_COORDINATES', senderName: 'PRIVATE_AGENCY' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_'); expect(result.event).toBe('大风');
  });
});
