import { afterEach, describe, expect, it, vi } from 'vitest';
import { service, weather } from './helpers/service.ts';
import { REALTIME_WEATHER_CURRENT_INTERVAL_MS } from '../src/world.ts';

let fixture: Awaited<ReturnType<typeof service>> | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });

describe('实况与预报合并', () => {
  it('初始化建立基线；每四轮空气质量更新一次，天气和预警每轮查询', async () => {
    fixture = await service();
    await fixture.world.start(fixture.host);
    expect(fixture.events).toEqual([]);
    for (let i = 0; i < 4; i++) { fixture.now += REALTIME_WEATHER_CURRENT_INTERVAL_MS; await fixture.world.pollCurrent(); }
    expect(fixture.counts).toMatchObject({ current: 5, alerts: 5, air: 2, hours: 1, days: 1 });
    expect(fixture.events).toEqual([]);
  });
  it('同轮开始下雨、空气变差与新增预警只产生一条事件', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    fixture.current = weather({ condition: { code: '305' }, precipitation: { type: 'rain', intensity: { value: 0.8 } } });
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '160', level: '4', category: '中度污染' };
    fixture.alerts = [{ id: 'warning-a', eventType: { name: 'rain', code: 'example' }, severity: 'severe', color: { code: 'orange' }, headline: 'PRIVATE_LOCATION', description: 'PRIVATE_KEY 42.33', senderName: 'PRIVATE_LOCATION', messageType: { code: 'alert' }, expireTime: new Date(fixture.now + 7200000).toISOString() }];
    await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(1);
    const text = fixture.events[0].text!;
    expect(text).toContain('开始下雨'); expect(text).toContain('160'); expect(text).toContain('预警发布');
    expect(text).toContain('空气里的湿气重了起来，雨点开始啪嗒啪嗒地砸在窗户上，赶紧起身把窗关小了些。');
    expect(text).not.toMatch(/PRIVATE_|42\.33|101\.12|qweatherapi|warning-a/);
  });
  it('缓慢升温相对上次提醒累积，其他字段事件不抹掉温度基线', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
    for (const value of [23, 24, 25]) {
      fixture.current = weather({ temperature: { value }, uvIndex: value === 23 ? 3 : 4 });
      await fixture.world.pollCurrent();
    }
    expect(fixture.events.some(e => e.text?.includes('温度22°C→25°C'))).toBe(true);
  });
  it('主动实况复用缓存，合并AQI和预警且隐藏地点和凭据', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
    const counts = { ...fixture.counts };
    const text = await fixture.world.tools()[0].handler({}, {} as never);
    expect(fixture.counts).toEqual(counts);
    expect(text).toContain('AQI(CN) 85'); expect(text).toContain('无有效预警'); expect(text).toContain('体感24°C');
    expect(text).not.toMatch(/PRIVATE_|42\.33|101\.12|当地｜|查询/);
  });
  it('预警失败保留最近数据且不产生解除事件，错误体不泄漏', async () => {
    fixture = await service();
    fixture.alerts = [{ id: 'a', eventType: { name: 'wind', code: 'example' }, severity: 'severe', messageType: { code: 'alert' } }];
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.errors.alerts = 403; await fixture.world.pollCurrent();
    expect(fixture.events).toEqual([]);
    const text = await fixture.world.tools()[0].handler({}, {} as never);
    expect(text).toContain('403'); expect(text).not.toContain('无有效预警'); expect(text).not.toContain('PRIVATE_');
  });
  it('预报按相同有效时刻比较，日期窗口前移不产生变化事件', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
    fixture.now += 3600000;
    fixture.hours = [...fixture.hours.slice(1), { ...weather(), forecastTime: new Date(fixture.now + 3 * 3600000).toISOString() }];
    fixture.days = fixture.days.slice(1);
    await fixture.world.pollForecast(); expect(fixture.events).toEqual([]);
    fixture.hours[0] = { ...fixture.hours[0], temperature: { value: 15, unit: '°C' } };
    fixture.days[0].temperatureMin = { value: 10 };
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1); expect(fixture.events[0].text).toContain('22°C→15°C'); expect(fixture.events[0].text).toContain('11/01');
  });
  it('明天取逐日项，主动预报只返回两个逐小时时段', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
    const text = String(await fixture.world.tools()[1].handler({}, {} as never));
    expect(text).toContain('11/01'); expect(text).toContain('15–23°C');
    expect(text).toContain('18:15'); expect(text).toContain('19:15'); expect(text).not.toContain('20:15');
  });
  it('未覆盖的单项变化只发数据；预留规则可由操作者补充', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
    fixture.current = weather({ visibility: { value: 500 } }); await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(1); expect(fixture.events[0].text).toContain('能见度'); expect(fixture.events[0].text).not.toContain('[');
  });
  it('默认配置可构造、读取声明和挂载，不请求真实服务', async () => {
    fixture = await service(); fixture.cfg.apiHost = ''; fixture.cfg.location = null;
    await fixture.world.start(fixture.host);
    expect(fixture.world.tools()).toHaveLength(2); expect(fixture.world.envPromptVars()).toEqual({}); expect(fixture.counts.current).toBe(0);
  });
  it('停止后不再轮询或投递日出日落事件', async () => {
    fixture = await service();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fixture.world.start(fixture.host); await fixture.world.stop();
      const counts = { ...fixture.counts };
      await vi.advanceTimersByTimeAsync(2 * 24 * 3600000);
      expect(fixture.counts).toEqual(counts); expect(fixture.events).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('地点只允许操作者从当前搜索结果选择，修改后持久化并重启', async () => {
    fixture = await service();
    const invoke = fixture.world.webUi().invoke!;
    await expect(invoke('config', 'selectCity', ['arbitrary'])).rejects.toThrow('搜索结果');
    const cities = await invoke('config', 'searchCities', ['Example']); expect(cities).toHaveLength(1);
    await invoke('config', 'selectCity', ['example-city']);
    expect(fixture.cfg.location?.timezone).toBe('Australia/Sydney'); expect(fixture.restarts).toBe(1);
  });
});
