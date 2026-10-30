import { afterEach, describe, expect, it, vi } from 'vitest';
import { service, weather } from './helpers/service.ts';
import { REALTIME_WEATHER_CURRENT_INTERVAL_MS } from '../src/world.ts';

let fixture: Awaited<ReturnType<typeof service>> | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });

describe('实况与预报合并', () => {
  it.each([["qaqi", 2, 4, 6], ["cn-mee", 2, 3, 6], ["cn-mee-1h", 2, 3, 6], ["hk-epd", 1, 3, 5], ["mo-smg", 1, 3, 6], ["tw-me", 1, 3, 6], ["tw-me-1h", 1, 3, 6], ["us-epa", 1, 3, 6], ["us-epa-nc", 1, 3, 6], ["eu-eea", 2, 4, 6], ["fr-atmo", 1, 3, 6], ["kr-moe", 1, 3, 4], ["jp-moe", 3, 4, 6], ["gb-defra", 1, 3, 4], ["ca-eccc", 1, 3, 4], ["sg-nea", 1, 3, 5], ["sg-nea-pm1h", 1, 2, 4], ["th-pcd", 2, 4, 5]])('%s按本地标准匹配改善、变差和良好文案', async (standard, good, polluted, worst) => {
    fixture = await service();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], code: standard, level: String(worst), category: 'PRIVATE_LOCATION 42.33' };
    await fixture.world.start(fixture.host);
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
    await fixture.world.start(fixture.host);
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
    await fixture.world.start(fixture.host);
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
    await fixture.world.start(fixture.host);
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
    await fixture.world.start(fixture.host);
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
    await fixture.world.start(fixture.host);
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '85', level: '2', category: '良' };
    fixture.current = weather(); await fixture.world.pollCurrent();
    expect(fixture.events.at(-1)?.text).not.toContain('浓雾终于散开');
  });
  it('浓雾恢复至轻雾只说能见度改善，不提前说雾散', async () => {
    fixture = await service();
    fixture.current = weather({ condition: { code: '501' }, visibility: { value: 500 } });
    await fixture.world.start(fixture.host);
    fixture.current = weather({ condition: { code: '501' }, visibility: { value: 1500 } });
    await fixture.world.pollCurrent();
    expect(fixture.events[0].text).toContain('虽然窗外的雾气还没完全散去');
    expect(fixture.events[0].text).not.toContain('明明没有起雾');
    expect(fixture.events[0].text).not.toContain('浓雾终于散开');
  });
  it('同一逐时预报的小温差不提醒，累积达到配置阈值才提醒', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
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
  it('非雾能见度变化使用不推断原因的通用句', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
    fixture.current = weather({ visibility: { value: 500 } }); await fixture.world.pollCurrent();
    expect(fixture.events).toHaveLength(1); expect(fixture.events[0].text).toContain('能见度'); expect(fixture.events[0].text).toContain('明明没有起雾，但稍远一点的楼房和街景');
    expect(fixture.events[0].text).not.toContain('雾气还没完全散去');
  });
  it('起雾及雾散用新增文案，温度事件不带未变化的污染文案', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
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
    fixture = await service(); await fixture.world.start(fixture.host);
    fixture.current = weather({ wind: { scale: 5 } }); await fixture.world.pollCurrent();
    expect(fixture.events[0].text).toContain('外面刮起了大风');
  });
  it('第三小时变化不发事件，远日风力变化不借用近期下雨文案', async () => {
    fixture = await service();
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.9 } };
    await fixture.world.start(fixture.host);
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
    await fixture.world.start(fixture.host);
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.7 } };
    await fixture.world.pollForecast();
    expect(fixture.events.at(-1)?.text).toContain('降雨概率突然升高');
    fixture.hours[0] = { ...fixture.hours[0], precipitation: { ...fixture.hours[0].precipitation, type: 'rain', probability: 0.1 } };
    await fixture.world.pollForecast();
    expect(fixture.events.at(-1)?.text).toContain('降水概率已经掉下去了');
  });
  it('预报失败轮次保留逐时及逐日的累计温差基线', async () => {
    fixture = await service(); await fixture.world.start(fixture.host);
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
    fixture = await service(); await fixture.world.start(fixture.host);
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
    fixture = await service(); fixture.errors.air = 503; await fixture.world.start(fixture.host);
    for (let i = 0; i < 3; i++) await fixture.world.pollCurrent();
    expect(fixture.counts.air).toBe(1);
    delete fixture.errors.air; await fixture.world.pollCurrent();
    expect(fixture.counts.air).toBe(2);
  });
  it('空气分阶段改善时保留污染期能见度基线，回执使用CN简称', async () => {
    fixture = await service();
    fixture.current = weather({ visibility: { value: 3000 }, condition: { code: '502' } });
    fixture.air.indexes[0] = { ...fixture.air.indexes[0], aqiDisplay: '180', level: '4', category: '中度污染' };
    await fixture.world.start(fixture.host);
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
    fixture = await service(); await fixture.world.start(fixture.host);
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
