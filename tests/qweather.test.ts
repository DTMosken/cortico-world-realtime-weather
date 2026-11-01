import { describe, expect, it } from 'vitest';
import { QWeather, QWeatherError, apiBase, normalizeAlert, normalizeWeather } from '../src/qweather.ts';
import { REALTIME_WEATHER_DEFAULTS } from '../src/config.ts';

describe('服务边界', () => {
  it.each([
    ['rain', 0, 0, 'none'], ['rain', 0, 2, 'none'], ['rain', 0.1, 0, 'rain'],
    ['rain', undefined, 0, 'none'], ['rain', undefined, 2, 'unknown'], ['rain', undefined, undefined, 'unknown'],
    ['none', undefined, 2, 'none'], ['snow', 0.1, 0, 'snow'], ['mixed', 0, 1, 'none'], ['ice', 0.1, 0, 'ice'],
  ])('实况类型%s、强度%s、累计量%s判为%s，逐小时保持原统计口径', async (type, intensity, amount, expected) => {
    const raw = { condition: { code: '101' }, precipitation: { type, ...(intensity === undefined ? {} : { intensity: { value: intensity } }), ...(amount === undefined ? {} : { amount: { value: amount } }) } };
    const client = new QWeather({ ...REALTIME_WEATHER_DEFAULTS, apiHost: 'example.qweatherapi.com', location: { name: 'Example', country: '', province: '', city: '', latitude: 0, longitude: 0, timezone: 'UTC' } }, () => 'test-key', async input => Response.json(String(input).includes('/hourly/') ? { hours: [{ ...raw, forecastTime: '2026-11-01T01:00:00Z' }] } : raw));
    const current = await client.current();
    expect(current.precipitationType).toBe(expected);
    expect(current.precipitationIntensity).toBe(intensity);
    expect(current.precipitationAmount).toBe(amount);
    expect((await client.hourly())[0].precipitationType).toBe(type);
  });

  it.each(['http://example.qweatherapi.com', '127.0.0.1', 'example.qweatherapi.com/path', 'example.qweatherapi.com@other.example', 'example.qweatherapi.com.other.example', 'example..qweatherapi.com'])('拒绝非控制台主机名：%s', host => { expect(() => apiBase(host)).toThrow(); });
  it('空字段保持缺失，累计降水不视为当前雨量', () => {
    const result = normalizeWeather({ condition: { code: '100' }, precipitation: { type: 'none', amount: { value: 5 } } });
    expect(result.temperature).toBeUndefined(); expect(result.precipitationIntensity).toBeUndefined(); expect(result.precipitationType).toBe('none');
  });
  it('模型可见预警不包含原文、发布机构、地点或消息id之外的额外字段', () => {
    const result = normalizeAlert({ id: 'message', eventType: { name: 'wind', code: '1' }, severity: 'severe', messageType: { code: 'alert' }, headline: 'PRIVATE_CITY', description: 'PRIVATE_COORDINATES', senderName: 'PRIVATE_AGENCY' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_'); expect(result.event).toBe('大风');
  });
  it('未选择地点时报告可显示错误，不发请求', async () => {
    let requests = 0;
    const client = new QWeather({ ...REALTIME_WEATHER_DEFAULTS, apiHost: 'example.qweatherapi.com', location: null }, () => 'test-key', async () => { requests++; return Response.json({}); });
    const error = await client.current().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QWeatherError); expect((error as Error).message).toBe('尚未选择城市或区划');
    expect(requests).toBe(0);
  });
});

describe('城市搜索筛选', () => {
  it('按上级行政区和国家缩小重名候选，空筛选不限制', async () => {
    const locations = [
      { id: 'a', name: 'Central', country: 'AA', adm1: 'North', adm2: 'River & Lake', lat: '1', lon: '2', tz: 'UTC' },
      { id: 'b', name: 'Central', country: 'BB', adm1: 'South', adm2: 'Hill', lat: '3', lon: '4', tz: 'UTC' },
    ];
    const request: typeof fetch = async input => {
      const params = new URL(String(input)).searchParams;
      const found = locations.filter(l => l.name === params.get('location')
        && (!params.has('adm') || l.adm2 === params.get('adm'))
        && (!params.has('range') || l.country.toLowerCase() === params.get('range')));
      return Response.json({ code: '200', location: found });
    };
    const client = new QWeather({ ...REALTIME_WEATHER_DEFAULTS, apiHost: 'example.qweatherapi.com' }, () => 'test-key', request);
    expect((await client.cities('Central')).map(l => l.id)).toEqual(['a', 'b']);
    expect((await client.cities('Central', { adm: ' River & Lake ', range: ' AA ' })).map(l => l.id)).toEqual(['a']);
    expect(await client.cities('Central', { adm: 'Hill', range: 'aa' })).toEqual([]);
    expect((await client.cities('Central'))[0].timezone).toBe('UTC');
    expect(await client.cities('Central', { adm: ' ', range: ' ' })).toHaveLength(2);
  });
});
