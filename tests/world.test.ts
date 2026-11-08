import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { service, weather } from './helpers/service.ts';
import { REALTIME_WEATHER_CURRENT_INTERVAL_MS } from '../src/world.ts';
import { solarTimes } from '../src/time.ts';

let fixture: Awaited<ReturnType<typeof service>> | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });

describe('实况与预报合并', () => {
  it('实况降水结合强度与累计量，零强度类型波动不报起停', async () => {
    fixture = await service();
    await fixture.start(); fixture.events.length = 0;
    const rain = (intensity: number | undefined, amount: number | undefined, type = 'rain') => weather({
      precipitation: { type, ...(intensity === undefined ? {} : { intensity: { value: intensity } }), ...(amount === undefined ? {} : { amount: { value: amount } }) },
    });
    for (const next of [rain(0, 0), rain(0, 0, 'none'), rain(undefined, 0), rain(undefined, 2)]) {
      fixture.current = next;
      await fixture.world.pollCurrent();
    }
    expect(fixture.events).toEqual([]);
    fixture.current = rain(0.2, 0);
    await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('开始下雨');
    fixture.current = rain(undefined, 2);
    await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(1);
    fixture.current = rain(0.2, 2);
    await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(1);
    fixture.current = rain(0, 2);
    await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(2);
    expect(fixture.events[1].text).toContain('雨停了');
    fixture.current = rain(0, 2, 'none');
    await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(2);
  });

  // 实况回执与降水判断一致：逐轮实况后返回通知的数据部分与主动查询回执。
  const reading = (code: string, intensity?: number, type = 'rain', amount = intensity) => weather({
    condition: { code }, precipitation: { type, ...(intensity === undefined ? {} : { intensity: { value: intensity } }), ...(amount === undefined ? {} : { amount: { value: amount } }) },
  });
  const observe = async (...steps: ReturnType<typeof weather>[]) => {
    await fixture?.close();
    // 同优先级候选中雷雨句排在小雨句之后，取末位候选才能检出雷雨句是否参选。
    fixture = await service('Australia/Sydney', false, () => 0.99);
    fixture.current = steps[0];
    await fixture.start(); fixture.events.length = 0;
    for (const step of steps.slice(1)) { fixture.current = step; await fixture.world.pollCurrent(); }
    const active = String(await fixture.world.tools()[0].handler({}, {} as never));
    return { notices: fixture.events.map(e => e.text!.split('\n\n')[0].replace(/^\d\d:\d\d｜/, '')), line: active.split('\n\n')[0], active };
  };
  const overcast = reading('104', 0, 'none');
  const THUNDER_TEXT = '窗外闪过一道白光';
  const ATMOSPHERE_CLEAR_RAIN = '[走到窗边，拨开窗帘确认了一下外面的情况，外面飘着细密的雨丝，路面已经被润湿成了深色。]';

  it('第1行：小雨0.5→小雨0 通知雨停了，数据行标明当前无降水', async () => {
    const { notices, line } = await observe(reading('305', 0.5), reading('305', 0));
    expect(notices).toEqual(['雨停了']);
    expect(line).toContain('｜小雨，当前无降水｜');
  });
  it('第2行：雷阵雨0.5→雷阵雨0 只通知雨停了，数据行标明当前无降水且不用雷雨文案', async () => {
    const { notices, line, active } = await observe(reading('302', 0.5), reading('302', 0));
    expect(notices).toEqual(['雨停了']);
    expect(line).toContain('｜雷阵雨，当前无降水｜');
    expect(active).not.toContain(THUNDER_TEXT);
  });
  it('第3行：阴0→小雨0 不通知，数据行标明当前无降水', async () => {
    const { notices, line } = await observe(overcast, reading('305', 0));
    expect(notices).toEqual([]);
    expect(line).toContain('｜小雨，当前无降水｜');
  });
  it('第4行：接第3行小雨0→小雨0.5 以保留的阴为基线通知描述变化与开始下雨', async () => {
    const { notices, line } = await observe(overcast, reading('305', 0), reading('305', 0.5));
    expect(notices).toEqual(['阴→小雨｜开始下雨']);
    expect(line).toContain('｜小雨0.5 mm/h｜');
  });
  it('第5行：阴0→雷阵雨0 不通知描述变化或出现雷阵雨，数据行标明当前无降水', async () => {
    const { notices, line, active } = await observe(overcast, reading('302', 0));
    expect(notices).toEqual([]);
    expect(line).toContain('｜雷阵雨，当前无降水｜');
    expect(active).not.toContain(THUNDER_TEXT);
  });
  it('第6行：小雨0.5→阴0.3 不通知且基线保持小雨，数据行显示降雨强度', async () => {
    const { notices, line } = await observe(reading('305', 0.5), reading('104', 0.3));
    expect(notices).toEqual([]);
    expect(line).toContain('｜阴，降雨0.3 mm/h｜');
    expect((await observe(reading('305', 0.5), reading('104', 0.3), reading('104', 0))).notices).toEqual(['小雨→阴｜雨停了']);
  });
  it('第7行：阴0→阴0.2 通知开始下雨，数据行显示降雨强度', async () => {
    const { notices, line } = await observe(overcast, reading('104', 0.2));
    expect(notices).toEqual(['开始下雨']);
    expect(line).toContain('｜阴，降雨0.2 mm/h｜');
  });
  it('第8行：晴0.2 数据行显示降雨强度，文案不变', async () => {
    const { line, active } = await observe(reading('100', 0.2));
    expect(line).toContain('｜晴，降雨0.2 mm/h｜');
    expect(active.split('\n\n')[1]).toBe(ATMOSPHERE_CLEAR_RAIN);
  });
  it('第9行：小雨强度缺失、累计0 数据行标明当前无降水', async () => {
    expect((await observe(reading('305', undefined, 'rain', 0))).line).toContain('｜小雨，当前无降水｜');
  });
  it('第10行：小雨强度缺失、累计0.3 判为unknown，不通知，数据行只显示描述', async () => {
    const { notices, line } = await observe(reading('305', 0.5), reading('305', undefined, 'rain', 0.3));
    expect(notices).toEqual([]);
    expect(line).toContain('｜小雨｜');
    expect((await observe(overcast, reading('305', undefined, 'rain', 0.3))).notices).toEqual([]);
  });
  it('第11行：阴0→小雨0.5 通知描述变化与开始下雨', async () => {
    expect((await observe(overcast, reading('305', 0.5))).notices).toEqual(['阴→小雨｜开始下雨']);
  });
  it('第12行：小雨0.5→阴0 通知描述变化与雨停了', async () => {
    expect((await observe(reading('305', 0.5), overcast)).notices).toEqual(['小雨→阴｜雨停了']);
  });
  it('第13行：雷阵雨0.5 数据行显示强度并配雷雨文案', async () => {
    const { line, active } = await observe(reading('302', 0.5));
    expect(line).toContain('｜雷阵雨0.5 mm/h｜');
    expect(active).toContain(THUNDER_TEXT);
  });
  it('第14行：未知加冰粒0.2→未知加无降水0 按强度通知起停', async () => {
    const { notices, line } = await observe(reading('999', 0.2, 'ice'), reading('999', 0, 'none'));
    expect(notices).toEqual(['特殊降水停止']);
    expect(line).toContain('｜未知｜');
  });
  it('雪与雨相同：描述先变不通知，确认后与起停一并通知；非降水描述显示降雪强度', async () => {
    const held = await observe(overcast, reading('400', 0, 'snow'));
    expect(held.notices).toEqual([]);
    expect(held.line).toContain('｜小雪，当前无降水｜');
    expect((await observe(overcast, reading('400', 0, 'snow'), reading('400', 0.3, 'snow'))).notices).toEqual(['阴→小雪｜开始下雪']);
    const cloudy = await observe(overcast, reading('104', 0.3, 'snow'));
    expect(cloudy.notices).toEqual(['开始下雪']);
    expect(cloudy.line).toContain('｜阴，降雪0.3 mm/h｜');
  });
  it.each([['mixed', '雨夹雪'], ['ice', '冰粒或冻雨']])('非降水描述确认%s时数据行显示%s强度', async (type, name) => {
    expect((await observe(reading('104', 0.3, type))).line).toContain(`｜阴，${name}0.3 mm/h｜`);
  });
  it('冻雨描述确认冰粒或冻雨时数据行附强度', async () => {
    expect((await observe(reading('313', 0.4, 'ice'))).line).toContain('｜冻雨0.4 mm/h｜');
  });
  it('雷阵雨转普通雨只在确认降水时通知', async () => {
    expect((await observe(reading('302', 0.5), reading('305', 0))).notices).toEqual(['雨停了']);
    expect((await observe(reading('302', 0.5), reading('305', 0.5))).notices).toEqual(['雷阵雨→小雨｜雷阵雨转普通雨']);
  });
  it.each([
    ['小雨0.5→雷阵雨0', [reading('305', 0.5), reading('302', 0)], ['雨停了']],
    ['小雪0.3→雷阵雨0', [reading('400', 0.3, 'snow'), reading('302', 0)], ['雪停了']],
    ['小雨0→雷阵雨0', [reading('305', 0), reading('302', 0)], []],
    ['小雨0.5→中雨0', [reading('305', 0.5), reading('306', 0)], ['雨停了']],
  ])('降水类内部描述变化未确认降水时不通知描述与雷阵雨：%s', async (_name, steps, expected) => {
    const { notices, line, active } = await observe(...steps);
    expect(notices).toEqual(expected);
    expect(line).toContain('，当前无降水｜');
    expect(fixture!.events.map(e => e.text).join('')).not.toContain('闷雷');
    expect(active).not.toContain(THUNDER_TEXT);
  });
  it('降水类内部描述变化待确认降水后与起停一并通知', async () => {
    expect((await observe(reading('305', 0.5), reading('302', 0), reading('302', 0.5))).notices).toEqual(['雨停了', '小雨→雷阵雨｜出现雷阵雨｜开始下雨']);
  });

  it.each(['预警发布', '降水概率'])('天气仍阴、仅%s变化时不夹带静态厚云句', async (change) => {
    fixture = await service();
    await fixture.start(); fixture.events.length = 0;
    if (change === '预警发布') {
      fixture.alerts = [{ id: 'a', eventType: { name: 'wind', code: 'example' }, severity: 'severe', messageType: { code: 'alert' } }];
    } else {
      fixture.current = weather({ precipitation: { type: 'none', intensity: { value: 0 }, probability: 0.8, amount: { value: 0 } } });
    }
    await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].type).toBe('realtime-weather.changed');
    expect(fixture.events[0].text).toContain(change);
    expect(fixture.events[0].text).not.toContain('天空被大片的云彩占满了');
  });

  it.each([
    ['101', true], ['104', true], ['151', true],
    ['102', false], ['103', false], ['152', false], ['153', false],
  ])('实况%s在启动摘要和主动查询中是否匹配厚云句 %s', async (code, thick) => {
    fixture = await service();
    fixture.current = weather({ condition: { code } });
    await fixture.start();
    const summary = fixture.events.find(e => e.type === 'realtime-weather.summary')!.text!;
    const active = String(await fixture.world.tools()[0].handler({}, {} as never));
    for (const text of [summary, active]) {
      if (thick) expect(text).toContain('天空被大片的云彩占满了');
      else expect(text).not.toContain('天空被大片的云彩占满了');
    }
  });

  it.each([
    ['100', '152', false], ['104', '153', false], ['100', '151', true], ['100', '104', true],
  ])('夜间%s到%s按云量选择厚云或通用文案', async (before, after, thick) => {
    fixture = await service();
    Object.assign(fixture.cfg.location!, { latitude: -34, longitude: 151 });
    fixture.now = Date.parse('2026-10-31T12:00:00Z');
    fixture.current = weather({ condition: { code: before } });
    await fixture.start(); fixture.events.length = 0;
    fixture.current = weather({ condition: { code: after } });
    await fixture.world.pollCurrent();
    const text = fixture.events[0].text!;
    if (thick) expect(text).toContain('厚云层彻底遮住');
    else {
      expect(text).toContain(before === '104' ? '窗外的云层变薄了不少，隐约能从云隙间透出一点微弱的夜空光亮。' : '天气状况不知不觉发生了一点变化');
      expect(text).not.toContain('厚云层彻底遮住');
      expect(text).not.toContain('亮堂了不少');
    }
  });

  it('延迟投递启动摘要时采用最新轮询数据和文案，只投递一次', async () => {
    fixture = await service('Australia/Sydney', true);
    await fixture.start();
    fixture.now += 3600000;
    fixture.current = weather({ condition: { code: '100' }, temperature: { value: 28 } });
    fixture.hours[0].temperature.value = 30;
    await fixture.world.pollCurrent(); await fixture.world.pollForecast();
    await fixture.flushDeferred();
    const summaries = fixture.events.filter(e => e.type === 'realtime-weather.summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].text).toContain('18:15｜晴');
    expect(summaries[0].text).toContain('28°C');
    expect(summaries[0].text).not.toContain('17:15｜');
    expect(summaries[0].text).toContain('AQI(CN) 85（良，17:15）');
    await fixture.flushDeferred();
    expect(fixture.events.filter(e => e.type === 'realtime-weather.summary')).toHaveLength(1);
  });

  it('跨整点合入完整预报时只重置实际展示小时的基线', async () => {
    fixture = await service('UTC');
    fixture.now = Date.parse('2026-10-31T07:30:00Z');
    fixture.hours.forEach((h, i) => { h.forecastTime = `2026-10-31T${String(8 + i).padStart(2, '0')}:00:00Z`; });
    await fixture.start(); fixture.events.length = 0;
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
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
    fixture.hours[2].uvIndex = 5;
    await fixture.world.pollForecast(); expect(fixture.events).toEqual([]);
    fixture.now += 3600000 + 1;
    await fixture.world.pollForecast();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('UV 2→5');
    await fixture.world.pollForecast(); expect(fixture.events).toHaveLength(1);
  });

  it('未选择地点时测试连接显示地点错误而非响应处理失败', async () => {
    fixture = await service(); fixture.cfg.location = null;
    const result = await fixture.world.webUi().invoke!('config', 'testConnection', []) as { errors: Record<string, string> };
    expect(result.errors).toMatchObject({ weather: '尚未选择城市或区划', hours: '尚未选择城市或区划' });
    expect(fixture.restarts).toBe(0);
  });
  it('停止期间编辑的文案在面板状态和下次启动时重新读取', async () => {
    fixture = await service();
    const invoke = fixture.world.webUi().invoke!;
    const ambience = async () => (await invoke('config', 'state', []) as { ambience: { usingDefault: boolean; error: string } }).ambience;
    mkdirSync(dirname(fixture.world.ambience.file), { recursive: true });
    writeFileSync(fixture.world.ambience.file, '{');
    expect(await ambience()).toMatchObject({ usingDefault: true, error: 'JSON语法错误' });
    writeFileSync(fixture.world.ambience.file, JSON.stringify({ version: 1, rules: [] }));
    await fixture.start();
    expect(fixture.world.ambience.error).toBe(''); expect(fixture.world.ambience.usingDefault).toBe(false);
  });

  it('启动摘要在投递前不落库，补投扫描不可见，投递时仅产生一条', async () => {
    fixture = await service('Australia/Sydney', true);
    await fixture.start();
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
    await fixture.start();
    await fixture.world.stop();
    await fixture.flushDeferred();
    expect(fixture.events).toEqual([]);
  });

  it('普通逐日通知刷新已展示风力范围及最高降水概率', async () => {
    fixture = await service();
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
    fixture.days[0].daytime.wind.scale = 5;
    fixture.days[0].nighttime.wind.scale = 2;
    fixture.days[0].nighttime.precipitation.probability = 0.5;
    await fixture.world.pollForecast();
    expect(fixture.events).toEqual([]);
  });
  it('日摘要风力及概率全部缺失时保留累计基线', async () => {
    fixture = await service();
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start();
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].text).toContain('11/01');
    expect(fixture.events[0].text).not.toContain('加床被子');
    expect(fixture.events[0].text).not.toContain('接下来的温度掉得厉害');
  });

  it('普通逐日通知刷新同时展示的UV及温度极值基线', async () => {
    fixture = await service();
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
    for (const delta of [1, 2, 3]) {
      fixture.hours[0].uvIndex = 2 + delta;
      fixture.days[0].uvIndexMax = 4 + delta;
      await fixture.world.pollForecast();
      expect(fixture.events).toHaveLength(delta === 3 ? 1 : 0);
    }
    expect(fixture.events[0].text).toContain('UV 2→5');
    expect(fixture.events[0].text).toContain('UV最高7');
  });

  it('配置页重排等待中的实况和每日预报，保留实况变化基线', async () => {
    fixture = await service();
    fixture.now = Date.parse('2026-10-31T10:07:00+11:00');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fixture.start();
      const save = (key: string, value: unknown) => fixture!.world.webUi().invoke!('config', 'save', [key, value]);
      await save('currentIntervalMinutes', 30);
      await save('alignChecksToClock', true);
      await save('dailyForecastTime', '10:30');
      fixture.current = weather({ temperature: { value: 32 } });
      fixture.events.length = 0;
      fixture.now += 22 * 60_000;
      await vi.advanceTimersByTimeAsync(22 * 60_000);
      expect(fixture.counts).toMatchObject({ current: 1, hours: 1 });
      fixture.now += 60_000;
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(fixture!.events.map(e => e.type).sort()).toEqual(['realtime-weather.changed', 'realtime-weather.forecast']));
      expect(fixture.counts).toMatchObject({ current: 2, hours: 2 });
      expect(fixture.restarts).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('每日按保存的地点时区08:00投递完整预报，不受部署时区影响且不要求预测修订', async () => {
    fixture = await service('Asia/Shanghai');
    fixture.now = Date.parse('2026-10-30T20:59:00Z');
    fixture.hours = [1, 2, 3].map(offset => ({ ...weather(), forecastTime: new Date(fixture!.now + offset * 3600000).toISOString() }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fixture.start();
      fixture.events.length = 0;
      fixture.now += 59_000;
      await vi.advanceTimersByTimeAsync(59_000);
      expect(fixture.events).toEqual([]);
      fixture.now += 1_000;
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(fixture!.events).toHaveLength(1));
      expect(fixture.events[0].type).toBe('realtime-weather.forecast');
      expect(fixture.events[0].text).toContain('08:59');
      expect(fixture.events[0].text).toContain('09:59');
      expect(fixture.events[0].text).toContain('11/01');
      expect(fixture.events[0].text).not.toMatch(/PRIVATE_|42\.33|101\.12/);
      expect(fixture.counts).toMatchObject({ current: 1, alerts: 1, air: 1, hours: 2, days: 2 });
      await fixture.world.stop();
      await vi.advanceTimersByTimeAsync(24 * 3600000);
      expect(fixture.events).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('回执采用保存的地点时区，不受部署时区影响，启动不查询地点', async () => {
    fixture = await service('UTC');
    await fixture.start();
    expect(fixture.counts.cities).toBe(0);
    expect(fixture.events[0].text).toContain('17:15');
    expect(fixture.events[0].text).toContain('18:15');
  });

  it('启动只投递一条实况、空气质量、预警和完整预报，并建立变化基线', async () => {
    fixture = await service();
    fixture.alerts = [{ id: 'a', eventType: { name: 'wind', code: 'example' }, severity: 'severe', messageType: { code: 'alert' } }];
    await fixture.start();
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
    await fixture.start();
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
    const starting = fixture.start();
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
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
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
    fixture.current = weather({ condition: { code }, precipitation: { type: 'snow', intensity: { value: 0.2 } } });
    const text = await fixture.world.tools()[0].handler({}, {} as never);
    expect(String(text).includes('鹅毛大雪')).toBe(heavy);
    if (['401', '407', '457', '499'].includes(code)) expect(String(text)).toContain('窗外正飘着雪');
  });
  it.each([['502', 8000], ['104', 8000], ['502', 3000], ['104', 3000]])('空气改善后天气%s、视程%s按当前环境选句', async (code, visibility) => {
    fixture = await service();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], level: '3', category: '轻度污染' };
    fixture.current = weather({ condition: { code }, visibility: { value: 3000 } });
    await fixture.start(); fixture.events.length = 0;
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
    fixture.current = weather({ condition: { code: '999' }, precipitation: { type: 'ice', intensity: { value: 0.2 } } });
    await fixture.start(); fixture.events.length = 0;
    fixture.current = weather({ condition: { code: '999' }, precipitation: { type: after, intensity: { value: after === 'none' ? 0 : 0.2 } } });
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
    await fixture.start(); fixture.events.length = 0;
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '85', level: '2', category: '良' };
    fixture.current = weather(); await fixture.world.pollCurrent();
    expect(fixture.events.at(-1)?.text).not.toContain('浓雾终于散开');
  });
  it('浓雾恢复至轻雾只说能见度改善，不提前说雾散', async () => {
    fixture = await service();
    fixture.current = weather({ condition: { code: '501' }, visibility: { value: 500 } });
    await fixture.start(); fixture.events.length = 0;
    fixture.current = weather({ condition: { code: '501' }, visibility: { value: 1500 } });
    await fixture.world.pollCurrent();
    expect(fixture.events[0].text).toContain('虽然窗外的雾气还没完全散去');
    expect(fixture.events[0].text).not.toContain('明明没有起雾');
    expect(fixture.events[0].text).not.toContain('浓雾终于散开');
  });
  it('同一逐时预报的小温差不提醒，累积达到配置阈值才提醒', async () => {
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
    expect(fixture.events).toEqual([]);
    for (let i = 0; i < 4; i++) { fixture.now += REALTIME_WEATHER_CURRENT_INTERVAL_MS; await fixture.world.pollCurrent(); }
    expect(fixture.counts).toMatchObject({ current: 5, alerts: 5, air: 2, hours: 1, days: 1 });
    expect(fixture.events).toEqual([]);
  });
  it('同轮开始下雨、空气变差与新增预警只产生一条事件', async () => {
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
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
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
    for (const value of [23, 24, 25]) {
      fixture.current = weather({ temperature: { value }, uvIndex: value === 23 ? 3 : 4 });
      await fixture.world.pollCurrent();
    }
    expect(fixture.events.some(e => e.text?.includes('温度22°C→25°C'))).toBe(true);
  });
  it('主动实况复用缓存，合并AQI和预警且隐藏地点和凭据', async () => {
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
    const counts = { ...fixture.counts };
    const text = await fixture.world.tools()[0].handler({}, {} as never);
    expect(fixture.counts).toEqual(counts);
    expect(text).toContain('AQI(CN) 85'); expect(text).toContain('无有效预警'); expect(text).toContain('体感24°C');
    expect(text).not.toMatch(/PRIVATE_|42\.33|101\.12|当地｜|查询/);
  });
  it('预警失败保留最近数据且不产生解除事件，错误体不泄漏', async () => {
    fixture = await service();
    fixture.alerts = [{ id: 'a', eventType: { name: 'wind', code: 'example' }, severity: 'severe', messageType: { code: 'alert' } }];
    await fixture.start(); fixture.events.length = 0;
    fixture.errors.alerts = 403; await fixture.world.pollCurrent();
    expect(fixture.events).toEqual([]);
    const text = await fixture.world.tools()[0].handler({}, {} as never);
    expect(text).toContain('403'); expect(text).not.toContain('无有效预警'); expect(text).not.toContain('PRIVATE_');
  });
  it('预报按相同有效时刻比较，日期窗口前移不产生变化事件', async () => {
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
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
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
    const text = String(await fixture.world.tools()[1].handler({}, {} as never));
    expect(text).toContain('11/01'); expect(text).toContain('15–23°C');
    expect(text).toContain('18:15'); expect(text).toContain('19:15'); expect(text).not.toContain('20:15');
  });
  it('非雾能见度变化使用不推断原因的通用句', async () => {
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
    fixture.current = weather({ visibility: { value: 500 } }); await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(1); expect(fixture.events[0].text).toContain('能见度'); expect(fixture.events[0].text).toContain('明明没有起雾，但稍远一点的楼房和街景');
    expect(fixture.events[0].text).not.toContain('雾气还没完全散去');
  });
  it('起雾及雾散用新增文案，温度事件不带未变化的污染文案', async () => {
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
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
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
    fixture.current = weather({ wind: { scale: 5 } }); await fixture.world.pollCurrent();
    expect(fixture.events[0].text).toContain('外面刮起了大风');
  });
  it('第三小时变化不发事件，远日风力变化不借用近期下雨文案', async () => {
    fixture = await service();
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.9 } };
    await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.7 } };
    await fixture.world.pollForecast();
    expect(fixture.events.at(-1)?.text).toContain('降雨概率突然升高');
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.1 } };
    await fixture.world.pollForecast();
    expect(fixture.events.at(-1)?.text).toContain('降水概率已经掉下去了');
  });
  it('预报失败轮次保留逐时及逐日的累计温差基线', async () => {
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
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
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
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
    fixture = await service(); fixture.errors.air = 503; await fixture.start(); fixture.events.length = 0;
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    expect(fixture.counts.air).toBe(1);
    delete fixture.errors.air; await fixture.world.pollCurrent();
    expect(fixture.counts.air).toBe(2);
  });
  it('空气分阶段改善时保留污染期能见度基线，回执使用CN简称', async () => {
    fixture = await service();
    fixture.current = weather({ visibility: { value: 3000 }, condition: { code: '502' } });
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '180', level: '4', category: '中度污染' };
    await fixture.start(); fixture.events.length = 0;
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
    fixture.alerts = [a, b]; await fixture.start(); fixture.events.length = 0;
    fixture.alerts = [a]; await fixture.world.pollCurrent();
    expect(fixture.events[0].text).toContain('道路结冰预警总算解除了');
    expect(fixture.events[0].text).not.toMatch(/PRIVATE_|大风预警总算/);
  });
  it('主动实况在途时第四轮仍合并空气刷新，只请求一次天气与预警', async () => {
    fixture = await service(); await fixture.start(); fixture.events.length = 0;
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
    await fixture.start(); fixture.events.length = 0;
    expect(fixture.world.tools()).toHaveLength(2); expect(fixture.world.envPromptVars()).toEqual({}); expect(fixture.counts.current).toBe(0);
  });
  it('停止后不再轮询或投递日出日落事件', async () => {
    fixture = await service();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fixture.start(); fixture.events.length = 0; await fixture.world.stop();
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
    expect(fixture.cfg.location).toEqual({ name: 'PRIVATE_LOCATION', country: 'Example', province: 'North', city: 'District', latitude: 42.33, longitude: 101.12, timezone: 'Australia/Sydney' });
    expect(fixture.restarts).toBe(1);
  });
  it('启动不等待天气查询完成，查询在后台完成后投递摘要', async () => {
    fixture = await service();
    let release!: () => void;
    fixture.holds.current = new Promise<void>(resolve => { release = resolve; });
    try {
      await fixture.world.start(fixture.host);
      expect(fixture.events).toEqual([]);
    } finally { release(); }
    await vi.waitFor(() => expect(fixture!.events.map(e => e.type)).toEqual(['realtime-weather.summary']));
  });
  it('测试连接只在本次实况成功且尚未初始化时重启', async () => {
    fixture = await service(); fixture.cfg.apiHost = '';
    await fixture.start();
    const invoke = fixture.world.webUi().invoke!;
    fixture.cfg.apiHost = 'example.qweatherapi.com'; fixture.errors.current = 500;
    expect(await invoke('config', 'testConnection', [])).toMatchObject({ errors: { weather: 'QWeather HTTP 500' } });
    expect(fixture.restarts).toBe(0);
    delete fixture.errors.current;
    await invoke('config', 'testConnection', []);
    expect(fixture.restarts).toBe(1);
  });
  it('已初始化后测试连接不重启；沿用的旧实况不算成功', async () => {
    fixture = await service(); await fixture.start();
    const invoke = fixture.world.webUi().invoke!;
    await invoke('config', 'testConnection', []);
    fixture.errors.current = 500;
    await invoke('config', 'testConnection', []);
    expect(fixture.restarts).toBe(0);
  });
  it('预警接口失败时保留已生效预警并标明沿用时间', async () => {
    fixture = await service();
    fixture.alerts = [{ id: 'a', eventType: { name: 'wind', code: '1006' }, severity: 'severe', messageType: { code: 'alert' } }];
    await fixture.start();
    fixture.errors.alerts = 503;
    fixture.now += 60_000;
    await fixture.world.pollCurrent();
    const text = await fixture.world.tools()[0].handler({}, {} as never) as string;
    expect(text).toContain('大风严重预警（沿用17:15）');
    expect(text).toContain('预警QWeather HTTP 503');
  });
  it('日出日落事件使用沿用天气时标明沿用时间', async () => {
    fixture = await service();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fixture.start();
      fixture.errors.current = 500;
      fixture.now += 60_000;
      await fixture.world.pollCurrent();
      await vi.advanceTimersByTimeAsync(24 * 3600000);
      const solar = fixture.events.find(e => e.type === 'realtime-weather.solar');
      expect(solar?.text).toMatch(/｜(日出|日落)｜阴（沿用17:15）/);
    } finally { vi.useRealTimers(); }
  });
  it.each([
    ['102', false], ['103', false], ['104', true], ['101', true], ['305', true],
  ])('日出日落：天气%s是否使用阴雨句 %s', async (code, wet) => {
    for (const kind of ['sunrise', 'sunset'] as const) {
      fixture = await service('Australia/Sydney', false, () => 0.99);
      const at = solarTimes(fixture.now, fixture.cfg.location!, 'Australia/Sydney')[kind]!.getTime();
      fixture.now = at - 60_000;
      fixture.current = weather({ condition: { code }, ...(code === '305' ? { precipitation: { type: 'rain', intensity: { value: 1 }, probability: 1, amount: { value: 1 } } } : {}) });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        await fixture.start();
        fixture.now = at;
        await vi.advanceTimersByTimeAsync(60_000);
        const text = fixture.events.find(e => e.type === 'realtime-weather.solar')!.text!;
        expect(text).toContain(kind === 'sunrise' ? '日出' : '日落');
        const sentence = kind === 'sunrise' ? '被厚重的云层（或雨雾）遮着' : '本来就是阴雨天';
        if (wet) expect(text).toContain(sentence); else expect(text).not.toContain(sentence);
      } finally { vi.useRealTimers(); }
      await fixture.close(); fixture = undefined;
    }
  });
  it('地点缺少时区时不启动查询，不退回部署时区，重新选择城市后恢复', async () => {
    fixture = await service('UTC');
    delete (fixture.cfg.location as { timezone?: string }).timezone;
    await fixture.start();
    expect(fixture.counts.current).toBe(0); expect(fixture.events).toEqual([]);
    const page = fixture.world.webUi();
    expect(page.lamps?.[0]).toMatchObject({ state: 'error', hint: '地点缺少时区，请重新选择城市或区划' });
    expect((await page.invoke!('config', 'state', []) as { errors: Record<string, string> }).errors).toMatchObject({ location: '地点缺少时区，请重新选择城市或区划' });
    expect(await fixture.world.tools()[0].handler({}, {} as never)).toContain('天气地点缺少时区，请重新选择城市或区划');
    expect(fixture.counts.current).toBe(0);
    await page.invoke!('config', 'searchCities', ['Example']);
    await page.invoke!('config', 'selectCity', ['example-city']);
    expect(fixture.cfg.location?.timezone).toBe('Australia/Sydney');
    expect(fixture.world.webUi().lamps?.[0].hint).not.toBe('地点缺少时区，请重新选择城市或区划');
  });
});
