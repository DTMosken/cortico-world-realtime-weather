import { afterEach, describe, expect, it, vi } from 'vitest';
import { service, weather } from './helpers/service.ts';
import { REALTIME_WEATHER_CURRENT_INTERVAL_MS } from '../src/world.ts';

let fixture: Awaited<ReturnType<typeof service>> | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });

describe('实况与预报合并', () => {
  it('跨整点合入完整预报时只重置实际展示小时的基线', async () => {
    fixture = await service('UTC');
    fixture.now = Date.parse('2026-10-31T07:30:00Z');
    fixture.hours.forEach((h, i) => { h.forecastTime = `2026-10-31T${String(8 + i).padStart(2, '0')}:00:00Z`; });
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.hours.forEach(h => { h.uvIndex = 4; });
    fixture.now = Date.parse('2026-10-31T07:59:59Z');
    let release!: () => void;
    fixture.holds.hours = new Promise<void>(resolve => { release = resolve; });
    const first = fixture.world.pollForecast();
    let summary: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(fixture!.counts.hours).toBe(2));
      fixture.now = Date.parse('2026-10-31T08:00:01Z');
      summary = fixture.world.pollForecast('summary');
    } finally { release(); await Promise.all([first, summary]); }
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('19:00｜');
    expect(fixture.events[0].text).toContain('20:00｜');
    expect(fixture.events[0].text).not.toContain('21:00｜');
    fixture.hours[2].uvIndex = 5;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(2);
    expect(fixture.events[1].text).toContain('21:00｜UV 2→5');
  });

  it('第三小时达到阈值的变化进入展示窗口后只提醒一次', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.hours[2].uvIndex = 5;
    await fixture.world.pollForecast(); expect(fixture.events).toEqual([]);
    fixture.now += 3600000 + 1;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('UV 2→5');
    await fixture.world.pollForecast(); expect(fixture.events).toHaveLength(1);
  });
  it('地点时区失败后十五分钟恢复初始化，摘要和常规轮询不重复', async () => {
    fixture = await service(); fixture.errors.cities = 503;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fixture.world.start(fixture.host);
      expect(fixture.world.webUi().lamps?.[0].state).toBe('error');
      expect(fixture.events).toEqual([]); expect(fixture.counts.current).toBe(0);
      for (const tool of fixture.world.tools()) expect(await tool.handler({}, {} as never)).toBe('地点时区查询失败：QWeather HTTP 503');
      expect(fixture.counts.current).toBe(0); expect(fixture.counts.hours).toBe(0);
      delete fixture.errors.cities;
      fixture.now += REALTIME_WEATHER_CURRENT_INTERVAL_MS;
      await vi.advanceTimersByTimeAsync(REALTIME_WEATHER_CURRENT_INTERVAL_MS);
      await vi.waitFor(() => expect(fixture!.events).toHaveLength(1));
      expect(fixture.counts).toMatchObject({ cities: 2, current: 1, hours: 1 });
      expect(fixture.world.webUi().lamps?.[0].state).toBe('online');
      fixture.now += REALTIME_WEATHER_CURRENT_INTERVAL_MS;
      await vi.advanceTimersByTimeAsync(REALTIME_WEATHER_CURRENT_INTERVAL_MS);
      await vi.waitFor(() => expect(fixture!.counts.current).toBe(2));
      expect(fixture.counts.cities).toBe(2); expect(fixture.events).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('时区初始化失败后停止会取消重试', async () => {
    fixture = await service(); fixture.errors.cities = 503;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fixture.world.start(fixture.host); await fixture.world.stop();
      await vi.advanceTimersByTimeAsync(REALTIME_WEATHER_CURRENT_INTERVAL_MS * 2);
      expect(fixture.counts.cities).toBe(1); expect(fixture.events).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('测试连接包含地点时区错误，恢复后才重启', async () => {
    fixture = await service(); fixture.errors.cities = 503;
    const invoke = fixture.world.webUi().invoke!;
    expect(await invoke('config', 'testConnection', [])).toMatchObject({ errors: { timezone: 'QWeather HTTP 503' } });
    expect(fixture.restarts).toBe(0);
    delete fixture.errors.cities;
    expect(await invoke('config', 'testConnection', [])).toMatchObject({ errors: {} });
    expect(fixture.restarts).toBe(1);
  });

  it('启动摘要在投递前不落库，补投扫描不可见，投递时仅产生一条', async () => {
    fixture = await service('Australia/Sydney', true);
    await fixture.world.start(fixture.host);
    expect(fixture.events).toEqual([]);
    await fixture.flushDeferred();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].type).toBe('realtime-weather.summary');
    expect(fixture.events[0].origin).toBe('external');
    expect(fixture.events[0].text).toContain('AQI(CN)');
    expect(fixture.events[0].text).toContain('无有效预警');
    expect(fixture.events[0].text).toContain('18:15');
    expect(fixture.events[0].text).toContain('11/01');
    await fixture.flushDeferred();
    expect(fixture.events).toHaveLength(1);
  });
  it('停止后未投递的启动摘要不再发送', async () => {
    fixture = await service('Australia/Sydney', true);
    await fixture.world.start(fixture.host);
    await fixture.world.stop();
    await fixture.flushDeferred();
    expect(fixture.events).toEqual([]);
  });

  it('普通逐日通知刷新已展示风力范围及最高降水概率', async () => {
    fixture = await service();
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    for (const part of ['daytime', 'nighttime'] as const) {
      fixture.days[0][part].wind.scale = 4;
      fixture.days[0][part].precipitation.probability = 0.3;
    }
    fixture.days[0].daytime.condition.code = '100';
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('风4级');
    expect(fixture.events[0].text).toContain('降水30%');
    for (const part of ['daytime', 'nighttime'] as const) {
      fixture.days[0][part].wind.scale = 5;
      fixture.days[0][part].precipitation.probability = 0.4;
    }
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    fixture.days[0].daytime.wind.scale = 6;
    fixture.days[0].daytime.precipitation.probability = 0.6;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(2);
    expect(fixture.events[1].text).toContain('风5–6级');
    expect(fixture.events[1].text).toContain('降水60%');
  });
  it('昼夜风力互换或较低降水概率改变不影响日摘要时不通知', async () => {
    fixture = await service();
    fixture.days[0].daytime.wind.scale = 2;
    fixture.days[0].nighttime.wind.scale = 5;
    fixture.days[0].daytime.precipitation.probability = 0.9;
    fixture.days[0].nighttime.precipitation.probability = 0.1;
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.days[0].daytime.wind.scale = 5;
    fixture.days[0].nighttime.wind.scale = 2;
    fixture.days[0].nighttime.precipitation.probability = 0.5;
    await fixture.world.pollForecast();
    expect(fixture.events).toEqual([]);
  });
  it('日摘要风力及概率全部缺失时保留累计基线', async () => {
    fixture = await service();
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    for (const part of ['daytime', 'nighttime'] as const) {
      Reflect.deleteProperty(fixture.days[0][part].wind, 'scale');
      Reflect.deleteProperty(fixture.days[0][part].precipitation, 'probability');
    }
    await fixture.world.pollForecast('summary');
    const line = fixture.events[0].text!.split('\n').find(l => l.startsWith('10/31'))!;
    expect(line).not.toContain('风'); expect(line).not.toContain('降水');
    fixture.days[0].daytime.wind.scale = 5;
    fixture.days[0].daytime.precipitation.probability = 0.4;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(2);
    expect(fixture.events[1].text).toContain('风5级');
    expect(fixture.events[1].text).toContain('降水40%');
  });
  it('启动摘要只有远日降温时不套今晚加被子的近期句', async () => {
    fixture = await service();
    fixture.current.temperature.value = 21.1;
    fixture.hours[0].temperature.value = 20.3;
    fixture.hours[1].temperature.value = 19.3;
    fixture.days[1].temperatureMin.value = 10;
    await fixture.world.start(fixture.host);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('11/01');
    expect(fixture.events[0].text).not.toContain('加床被子');
    expect(fixture.events[0].text).not.toContain('接下来的温度掉得厉害');
  });

  it('普通逐日通知刷新同时展示的UV及温度极值基线', async () => {
    fixture = await service();
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.days[0].daytime = weather({ condition: { code: '100' } });
    fixture.days[0].uvIndexMax = 6;
    fixture.days[0].temperatureMin.value = 20;
    fixture.days[0].temperatureMax.value = 27;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('20–27°C');
    expect(fixture.events[0].text).toContain('UV最高6');
    fixture.days[0].uvIndexMax = 7;
    fixture.days[0].temperatureMin.value = 21;
    fixture.days[0].temperatureMax.value = 28;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    fixture.days[0].uvIndexMax = 9;
    fixture.days[0].temperatureMin.value = 23;
    fixture.days[0].temperatureMax.value = 30;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(2);
    expect(fixture.events[1].text).toContain('23–30°C');
    expect(fixture.events[1].text).toContain('UV最高9');
  });
  it.each(['summary', 'changes'] as const)('%s通知缺少最低温时保留未展示的最高温基线', async (mode) => {
    fixture = await service();
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    Reflect.deleteProperty(fixture.days[0], 'temperatureMin');
    fixture.days[0].temperatureMax.value = 27;
    fixture.days[0].daytime = weather({ condition: { code: '100' } });
    await fixture.world.pollForecast(mode);
    expect(fixture.events).toHaveLength(1);
    const line = fixture.events[0].text!.split('\n').find(l => l.startsWith('10/31'))!;
    expect(line).not.toContain('°C');
    fixture.days[0].temperatureMax.value = 28;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    fixture.days[0].temperatureMin = { value: 18 };
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(2);
    expect(fixture.events[1].text).toContain('18–28°C');
  });

  it('完整预报刷新已播报数值基线，未展示的第三小时保留累计', async () => {
    fixture = await service();
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.hours.forEach(h => { h.uvIndex = 4; h.temperature.value = 24; });
    fixture.days[0].uvIndexMax = 6;
    fixture.days[0].temperatureMin.value = 20;
    fixture.days[0].temperatureMax.value = 27;
    await fixture.world.pollForecast('summary');
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('UV 4');
    fixture.hours.forEach(h => { h.uvIndex = 5; h.temperature.value = 25; });
    fixture.days[0].uvIndexMax = 7;
    fixture.days[0].temperatureMin.value = 21;
    fixture.days[0].temperatureMax.value = 28;
    // Keep the third hour unchanged until it enters the displayed window.
    fixture.hours[2].uvIndex = 4; fixture.hours[2].temperature.value = 24;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    fixture.now += 3600000;
    fixture.hours[2].uvIndex = 5;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(2);
    expect(fixture.events[1].text).toContain('UV 2→5');
    fixture.hours[1].uvIndex = 7;
    fixture.days[0].uvIndexMax = 9;
    fixture.days[0].temperatureMin.value = 23;
    await fixture.world.pollForecast();
    expect(fixture.events.at(-1)!.text).toContain('UV 4→7');
    expect(fixture.events.at(-1)!.text).toContain('UV最高9');
  });
  it.each([false, true])('每日摘要与小时轮询重叠只发送完整预报，摘要先发起=%s', async (summaryFirst) => {
    fixture = await service();
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.hours[0].uvIndex = 5;
    let release!: () => void;
    fixture.holds.hours = new Promise<void>(resolve => { release = resolve; });
    const first = fixture.world.pollForecast(summaryFirst ? 'summary' : 'changes');
    let second: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(fixture!.counts.hours).toBe(2));
      second = fixture.world.pollForecast(summaryFirst ? 'changes' : 'summary');
    } finally { release(); await Promise.all([first, second]); }
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('UV 5');
    expect(fixture.events[0].text).toContain('11/01');
    expect(fixture.events[0].text).not.toContain('UV 2→5');
    expect(fixture.counts).toMatchObject({ hours: 2, days: 2 });
  });
  it('逐小时与逐日缺失数值不会清除UV和温度极值基线', async () => {
    fixture = await service();
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.hours[0].uvIndex = 4;
    fixture.days[0].uvIndexMax = 6;
    fixture.days[0].temperatureMin.value = 20;
    fixture.days[0].temperatureMax.value = 27;
    await fixture.world.pollForecast();
    Reflect.deleteProperty(fixture.hours[0], 'uvIndex');
    Reflect.deleteProperty(fixture.days[0], 'uvIndexMax');
    Reflect.deleteProperty(fixture.days[0], 'temperatureMin');
    Reflect.deleteProperty(fixture.days[0], 'temperatureMax');
    await fixture.world.pollForecast('summary');
    expect(fixture.events).toHaveLength(1);
    fixture.hours[0].uvIndex = 5;
    fixture.days[0].uvIndexMax = 7;
    fixture.days[0].temperatureMin = { value: 21 };
    fixture.days[0].temperatureMax = { value: 28 };
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(2);
    expect(fixture.events[1].text).toContain('UV 2→5');
    expect(fixture.events[1].text).toContain('21–28°C');
    expect(fixture.events[1].text).toContain('UV最高7');
  });

  it('逐小时和逐日UV修订累计达到3才通知', async () => {
    fixture = await service();
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    for (const delta of [1, 2, 3]) {
      fixture.hours[0].uvIndex = 2 + delta;
      fixture.days[0].uvIndexMax = 4 + delta;
      await fixture.world.pollForecast();
      expect(fixture.events).toHaveLength(delta === 3 ? 1 : 0);
    }
    expect(fixture.events[0].text).toContain('UV 2→5');
    expect(fixture.events[0].text).toContain('UV最高7');
  });

  it('每日按部署时区08:00投递完整预报，即使预测没有修订', async () => {
    fixture = await service('Asia/Shanghai');
    fixture.now = Date.parse('2026-10-30T23:59:00Z');
    fixture.hours = [1, 2, 3].map(offset => ({ ...weather(), forecastTime: new Date(fixture!.now + offset * 3600000).toISOString() }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fixture.world.start(fixture.host);
      fixture.events.length = 0;
      fixture.now += 59_000;
      await vi.advanceTimersByTimeAsync(59_000);
      expect(fixture.events).toEqual([]);
      fixture.now += 1_000;
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(fixture!.events).toHaveLength(1));
      expect(fixture.events[0].type).toBe('realtime-weather.forecast');
      expect(fixture.events[0].text).toContain('11:59');
      expect(fixture.events[0].text).toContain('12:59');
      expect(fixture.events[0].text).toContain('11/01');
      expect(fixture.events[0].text).not.toMatch(/PRIVATE_|42\.33|101\.12/);
      expect(fixture.counts).toMatchObject({ current: 1, alerts: 1, air: 1, hours: 2, days: 2 });
      await fixture.world.stop();
      await vi.advanceTimersByTimeAsync(24 * 3600000);
      expect(fixture.events).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('启动移除旧地点时区，GeoAPI时区仅在内存用于回执', async () => {
    fixture = await service('UTC');
    Object.assign(fixture.cfg.location!, { timezone: 'America/New_York' });
    await fixture.world.start(fixture.host);
    expect(fixture.cfg.location).not.toHaveProperty('timezone');
    expect(fixture.events[0].text).toContain('17:15');
    expect(fixture.events[0].text).toContain('18:15');
  });

  it('启动只投递一条实况、空气质量、预警和完整预报，并建立变化基线', async () => {
    fixture = await service();
    fixture.alerts = [{ id: 'a', eventType: { name: 'wind', code: 'example' }, severity: 'severe', messageType: { code: 'alert' } }];
    await fixture.world.start(fixture.host);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].type).toBe('realtime-weather.summary');
    const text = fixture.events[0].text!;
    expect(text).toContain('22°C');
    expect(text).toContain('AQI(CN) 85');
    expect(text).toContain('大风');
    expect(text).toContain('18:15');
    expect(text).toContain('19:15');
    expect(text).toContain('11/01');
    expect(text).not.toMatch(/PRIVATE_|42\.33|101\.12|example-city/);
    expect(fixture.counts).toMatchObject({ current: 1, alerts: 1, air: 1, hours: 1, days: 1 });
    await fixture.world.pollCurrent();
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
  });
  it('启动部分接口失败时合并成功数据与错误，不漏掉整条通知', async () => {
    fixture = await service(); fixture.errors.hours = 503;
    await fixture.world.start(fixture.host);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('22°C');
    expect(fixture.events[0].text).toContain('11/01');
    expect(fixture.events[0].text).toContain('503');
  });

  it('启动首轮成功亮绿灯，后续失败亮红灯，测试连接成功恢复绿灯', async () => {
    fixture = await service();
    const lamp = () => fixture!.world.webUi().lamps?.[0].state;
    expect(lamp()).toBe('offline');
    let release!: () => void;
    fixture.holds.current = new Promise<void>(resolve => { release = resolve; });
    const starting = fixture.world.start(fixture.host);
    try { await vi.waitFor(() => expect(lamp()).toBe('loading')); } finally { release(); await starting; }
    expect(lamp()).toBe('online');
    fixture.errors.alerts = 503;
    await fixture.world.pollCurrent();
    expect(lamp()).toBe('error');
    delete fixture.errors.alerts;
    await fixture.world.webUi().invoke!('config', 'testConnection', []);
    expect(lamp()).toBe('online');
  });
  it('未启动时测试连接成功也亮绿灯', async () => {
    fixture = await service();
    await fixture.world.webUi().invoke!('config', 'testConnection', []);
    expect(fixture.world.webUi().lamps?.[0].state).toBe('online');
  });

  it('单个自定义配置面板可保存配置并按声明限制输入', async () => {
    fixture = await service();
    const page = fixture.world.webUi();
    expect(page.config).toBeUndefined();
    expect(page.panels?.map(panel => panel.id)).toEqual(['config']);
    const invoke = page.invoke!;
    await invoke('config', 'save', ['temperatureChange', 4.5]);
    expect(fixture.cfg.temperatureChange).toBe(4.5);
    await expect(invoke('config', 'save', ['forecastDays', 11])).rejects.toThrow();
    await expect(invoke('config', 'save', ['location', {}])).rejects.toThrow();
    await expect(invoke('config', 'save', ['unlisted', true])).rejects.toThrow();
    await expect(invoke('config', 'save', ['apiHost', 'https://other.example'])).rejects.toThrow();
    expect(fixture.restarts).toBe(0);
    await invoke('config', 'save', ['apiHost', 'newhost.qweatherapi.com']);
    expect(fixture.cfg.apiHost).toBe('newhost.qweatherapi.com');
    expect(fixture.restarts).toBe(1);
  });

  it.each([["qaqi", 2, 4, 6], ["cn-mee", 2, 3, 6], ["cn-mee-1h", 2, 3, 6], ["hk-epd", 1, 3, 5], ["mo-smg", 1, 3, 6], ["tw-me", 1, 3, 6], ["tw-me-1h", 1, 3, 6], ["us-epa", 1, 3, 6], ["us-epa-nc", 1, 3, 6], ["eu-eea", 2, 4, 6], ["fr-atmo", 1, 3, 6], ["kr-moe", 1, 3, 4], ["jp-moe", 3, 4, 6], ["gb-defra", 1, 3, 4], ["ca-eccc", 1, 3, 4], ["sg-nea", 1, 3, 5], ["sg-nea-pm1h", 1, 2, 4], ["th-pcd", 2, 4, 5]])('%s按本地标准匹配改善、变差和良好文案', async (standard, good, polluted, worst) => {
    fixture = await service();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], code: standard, level: String(worst), category: 'PRIVATE_LOCATION 42.33' };
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    const update = async (level: number) => {
      fixture!.air.indexes[0].level = String(level);
      for (let i = 0; i < 4; i++) await fixture!.world.pollCurrent();
      return fixture!.events.at(-1)!.text!;
    };
    expect(await update(polluted)).toContain('窗户还是先关着比较好');
    expect(await update(good)).toContain('总算可以推开窗痛快地换口气');
    const bad = await update(polluted);
    expect(bad).toContain('赶紧起身把窗户关严实了');
    expect(fixture.events.map(e => e.text).join('')).not.toContain('PRIVATE_LOCATION');
  });
  it.each([
    ['ca-eccc', 3], ['gb-defra', 3], ['hk-epd', 3], ['kr-moe', 3],
    ['sg-nea', 3], ['sg-nea-pm1h', 3], ['jp-moe', 5],
  ])('%s较高风险不按统一4级误选轻霾或水雾句', async (standard, level) => {
    fixture = await service();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], code: standard, level: String(level) };
    fixture.current = weather({ condition: { code: '502' } });
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    const text = String(await fixture.world.tools()[0].handler({}, {} as never));
    expect(text).toContain('空气看起来很浑浊');
    expect(text).not.toContain('带着一点灰蒙蒙');
    fixture.current = weather({ condition: { code: '501' }, visibility: { value: 500 } });
    await fixture.world.pollCurrent();
    expect(fixture.events.at(-1)!.text).not.toContain('白茫茫的水汽');
  });

  it.each([
    ['ca-eccc', '高风险', '低风险'],
    ['gb-defra', '高', '低'],
  ])('%s低风险且视程恢复时匹配空气改善文案', async (standard, high, low) => {
    fixture = await service();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], code: standard, level: '3', category: high };
    fixture.current = weather({ condition: { code: '502' }, visibility: { value: 2000 } });
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], level: '1', category: low, aqiDisplay: '2' };
    fixture.current = weather({ visibility: { value: 8000 } });
    await fixture.world.pollCurrent();
    const text = fixture.events.at(-1)!.text!;
    expect(text).toContain(low);
    expect(text).toContain('外面的灰霾终于散干净了');
    expect(text).not.toContain('等级1');
  });
  it.each([
    ['407', false], ['408', false], ['457', false], ['401', false], ['499', false],
    ['402', true], ['403', true], ['409', true], ['410', true],
  ])('降雪代码%s的大雪描述符合强度分类', async (code, heavy) => {
    fixture = await service();
    fixture.current = weather({ condition: { code }, precipitation: { type: 'snow' } });
    const text = await fixture.world.tools()[0].handler({}, {} as never);
    expect(String(text).includes('鹅毛大雪')).toBe(heavy);
    if (['401', '407', '457', '499'].includes(code)) expect(String(text)).toContain('窗外正飘着雪');
  });
  it.each([['502', 8000], ['104', 8000], ['502', 3000], ['104', 3000]])('空气改善后天气%s、视程%s按当前环境选句', async (code, visibility) => {
    fixture = await service();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], level: '3', category: '轻度污染' };
    fixture.current = weather({ condition: { code }, visibility: { value: 3000 } });
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], level: '2', category: '良' };
    fixture.current = weather({ condition: { code }, visibility: { value: visibility } });
    await fixture.world.pollCurrent();
    expect(fixture.events.at(-1)!.text).not.toMatch(/灰霾终于散干净|浑浊的天空被风/);
    const text = fixture.events.at(-1)!.text!;
    if (code === '104') expect(text).toContain('总算可以推开窗痛快地换口气');
    else { expect(text).toContain('AQI'); expect(text).not.toContain('['); }
  });
  it.each(['none', 'mixed'])('特殊降水转%s只在仍降水时使用形态变化句', async after => {
    fixture = await service();
    fixture.current = weather({ condition: { code: '999' }, precipitation: { type: 'ice' } });
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.current = weather({ condition: { code: '999' }, precipitation: { type: after } });
    await fixture.world.pollCurrent();
    const text = fixture.events.at(-1)!.text!;
    if (after === 'none') {
      expect(text).toContain('特殊降水停止');
      expect(text).toContain('外面噼里啪啦的动静总算消停了');
      expect(text).not.toContain('窗外落下来的东西变了样');
    } else expect(text).toContain('窗外落下来的东西变了样');
  });
  it('雾散文案查上一轮AQI，污染改善不能误作水雾散去', async () => {
    fixture = await service();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '180', level: '4', category: '中度污染' };
    fixture.current = weather({ condition: { code: '501' }, visibility: { value: 500 } });
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '85', level: '2', category: '良' };
    fixture.current = weather(); await fixture.world.pollCurrent();
    expect(fixture.events.at(-1)?.text).not.toContain('浓雾终于散开');
  });
  it('浓雾恢复至轻雾只说能见度改善，不提前说雾散', async () => {
    fixture = await service();
    fixture.current = weather({ condition: { code: '501' }, visibility: { value: 500 } });
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.current = weather({ condition: { code: '501' }, visibility: { value: 1500 } });
    await fixture.world.pollCurrent();
    expect(fixture.events[0].text).toContain('虽然窗外的雾气还没完全散去');
    expect(fixture.events[0].text).not.toContain('明明没有起雾');
    expect(fixture.events[0].text).not.toContain('浓雾终于散开');
  });
  it('同一逐时预报的小温差不提醒，累积达到配置阈值才提醒', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    const original = fixture.hours[0].temperature.value;
    const threshold = fixture.cfg.temperatureChange;
    fixture.hours[0].temperature.value = original + threshold - 1;
    await fixture.world.pollForecast(); expect(fixture.events).toEqual([]);
    fixture.hours[0].temperature.value = original + threshold;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain(`温度${original}°C→${original + threshold}°C`);
    expect(fixture.events[0].text).not.toContain('一两度');
  });
  it('初始化建立基线；每四轮空气质量更新一次，天气和预警每轮查询', async () => {
    fixture = await service();
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    expect(fixture.events).toEqual([]);
    for (let i = 0; i < 4; i++) { fixture.now += REALTIME_WEATHER_CURRENT_INTERVAL_MS; await fixture.world.pollCurrent(); }
    expect(fixture.counts).toMatchObject({ current: 5, alerts: 5, air: 2, hours: 1, days: 1 });
    expect(fixture.events).toEqual([]);
  });
  it('同轮开始下雨、空气变差与新增预警只产生一条事件', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
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
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    for (const value of [23, 24, 25]) {
      fixture.current = weather({ temperature: { value }, uvIndex: value === 23 ? 3 : 4 });
      await fixture.world.pollCurrent();
    }
    expect(fixture.events.some(e => e.text?.includes('温度22°C→25°C'))).toBe(true);
  });
  it('主动实况复用缓存，合并AQI和预警且隐藏地点和凭据', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
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
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
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
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    const text = String(await fixture.world.tools()[1].handler({}, {} as never));
    expect(text).toContain('11/01'); expect(text).toContain('15–23°C');
    expect(text).toContain('18:15'); expect(text).toContain('19:15'); expect(text).not.toContain('20:15');
  });
  it('非雾能见度变化使用不推断原因的通用句', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.current = weather({ visibility: { value: 500 } }); await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(1); expect(fixture.events[0].text).toContain('能见度'); expect(fixture.events[0].text).toContain('明明没有起雾，但稍远一点的楼房和街景');
    expect(fixture.events[0].text).not.toContain('雾气还没完全散去');
  });
  it('起雾及雾散用新增文案，温度事件不带未变化的污染文案', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.current = weather({ condition: { code: '501' }, visibility: { value: 500 } });
    await fixture.world.pollCurrent();
    expect(fixture.events.at(-1)?.text).toContain('白茫茫的水汽里');
    fixture.current = weather(); await fixture.world.pollCurrent();
    expect(fixture.events.at(-1)?.text).toContain('浓雾终于散开了');
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '160', level: '4', category: '中度污染' };
    await fixture.world.pollCurrent(); await fixture.world.pollCurrent();
    fixture.events.length = 0;
    fixture.current = weather({ temperature: { value: 25, unit: '°C' } });
    await fixture.world.pollCurrent();
    expect(fixture.events[0].text).toContain('温度不知不觉爬升');
    expect(fixture.events[0].text).not.toContain('灰蒙蒙');
  });
  it('风力达到5级的变化接上已有大风句', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.current = weather({ wind: { scale: 5 } }); await fixture.world.pollCurrent();
    expect(fixture.events[0].text).toContain('外面刮起了大风');
  });
  it('第三小时变化不发事件，远日风力变化不借用近期下雨文案', async () => {
    fixture = await service();
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.9 } };
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.hours[2] = { ...fixture.hours[2], temperature: { value: 10, unit: '°C' } };
    await fixture.world.pollForecast(); expect(fixture.events).toEqual([]);
    fixture.days[1].daytime = weather({ wind: { scale: 6 } });
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).not.toMatch(/一会儿要下雨|\[/);
  });
  it('降水概率升降文案进入合并预报事件', async () => {
    fixture = await service();
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.4 } };
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.7 } };
    await fixture.world.pollForecast();
    expect(fixture.events.at(-1)?.text).toContain('降雨概率突然升高');
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.1 } };
    await fixture.world.pollForecast();
    expect(fixture.events.at(-1)?.text).toContain('降水概率已经掉下去了');
  });
  it('预报失败轮次保留逐时及逐日的累计温差基线', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.hours[0] = { ...fixture.hours[0], temperature: { value: 23, unit: '°C' } };
    fixture.days[1].temperatureMax = { value: 25 };
    await fixture.world.pollForecast(); expect(fixture.events).toEqual([]);
    fixture.errors.hours = 503; fixture.errors.days = 503;
    await fixture.world.pollForecast(); expect(fixture.events).toEqual([]);
    delete fixture.errors.hours; delete fixture.errors.days;
    fixture.hours[0] = { ...fixture.hours[0], temperature: { value: 25, unit: '°C' } };
    fixture.days[1].temperatureMax = { value: 26 };
    await fixture.world.pollForecast();
    expect(fixture.events[0].text).toContain('22°C→25°C');
    expect(fixture.events[0].text).toContain('15–26°C');
  });
  it('失败缓存保留旧数据时间，主动查询可立即重试', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.now += REALTIME_WEATHER_CURRENT_INTERVAL_MS;
    fixture.errors.current = 503;
    await fixture.world.pollCurrent();
    const stale = String(await fixture.world.tools()[0].handler({}, {} as never));
    expect(stale).toContain('沿用17:15');
    delete fixture.errors.current;
    fixture.current = weather({ temperature: { value: 28 } });
    expect(await fixture.world.tools()[0].handler({}, {} as never)).toContain('28°C');
    fixture.errors.hours = 503; await fixture.world.pollForecast();
    delete fixture.errors.hours;
    fixture.hours[0] = { ...fixture.hours[0], temperature: { value: 14, unit: '°C' } };
    expect(await fixture.world.tools()[1].handler({}, {} as never)).toContain('14°C');
  });
  it('空气失败仍按四轮查询，不在中间轮次重试', async () => {
    fixture = await service(); fixture.errors.air = 503; await fixture.world.start(fixture.host); fixture.events.length = 0;
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    expect(fixture.counts.air).toBe(1);
    delete fixture.errors.air; await fixture.world.pollCurrent();
    expect(fixture.counts.air).toBe(2);
  });
  it('空气分阶段改善时保留污染期能见度基线，回执使用CN简称', async () => {
    fixture = await service();
    fixture.current = weather({ visibility: { value: 3000 }, condition: { code: '502' } });
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '180', level: '4', category: '中度污染' };
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.current = weather({ visibility: { value: 8000 } });
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '120', level: '3', category: '轻度污染' };
    for (let i = 0; i < 4; i++) { fixture.now += REALTIME_WEATHER_CURRENT_INTERVAL_MS; await fixture.world.pollCurrent(); }
    fixture.events.length = 0;
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '85', level: '2', category: '良' };
    for (let i = 0; i < 4; i++) { fixture.now += REALTIME_WEATHER_CURRENT_INTERVAL_MS; await fixture.world.pollCurrent(); }
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('AQI(CN)');
    expect(fixture.events[0].text).toContain('外面的灰霾终于散干净了');
  });
  it('预警解除文案填被解除的类型，其他仍有效预警不干扰', async () => {
    fixture = await service();
    const a = { id: 'wind-a', eventType: { name: 'wind', code: '1006' }, severity: 'severe', messageType: { code: 'alert' } };
    const b = { ...a, id: 'ice-a', eventType: { name: 'PRIVATE_LOCATION', code: '1021' } };
    fixture.alerts = [a, b]; await fixture.world.start(fixture.host); fixture.events.length = 0;
    fixture.alerts = [a]; await fixture.world.pollCurrent();
    expect(fixture.events[0].text).toContain('道路结冰预警总算解除了');
    expect(fixture.events[0].text).not.toMatch(/PRIVATE_|大风预警总算/);
  });
  it('主动实况在途时第四轮仍合并空气刷新，只请求一次天气与预警', async () => {
    fixture = await service(); await fixture.world.start(fixture.host); fixture.events.length = 0;
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    fixture.now += REALTIME_WEATHER_CURRENT_INTERVAL_MS;
    let release!: () => void;
    fixture.holds.current = new Promise<void>(resolve => { release = resolve; });
    const before = { ...fixture.counts };
    const active = fixture.world.tools()[0].handler({}, {} as never);
    try {
      await vi.waitFor(() => expect(fixture!.counts.current).toBe(before.current + 1));
      fixture.air.indexes[0].aqiDisplay = '95';
      const passive = fixture.world.pollCurrent();
      release();
      expect(await active).toContain('95'); await passive;
      expect(fixture.counts).toMatchObject({ current: before.current + 1, alerts: before.alerts + 1, air: before.air + 1 });
    } finally { release(); await active; }
  });
  it('默认配置可构造、读取声明和挂载，不请求真实服务', async () => {
    fixture = await service(); fixture.cfg.apiHost = ''; fixture.cfg.location = null;
    await fixture.world.start(fixture.host); fixture.events.length = 0;
    expect(fixture.world.tools()).toHaveLength(2); expect(fixture.world.envPromptVars()).toEqual({}); expect(fixture.counts.current).toBe(0);
  });
  it('停止后不再轮询或投递日出日落事件', async () => {
    fixture = await service();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fixture.world.start(fixture.host); fixture.events.length = 0; await fixture.world.stop();
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
    expect(fixture.cfg.location).not.toHaveProperty('timezone'); expect(fixture.restarts).toBe(1);
  });
});
