import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { CityCandidate, RealtimeWeatherConfigSection } from '../config.ts';
import { realtimeWeatherConfigGroup } from '../config.ts';

interface State {
  config: RealtimeWeatherConfigSection;
  keySet: boolean;
  ambience: { file: string; usingDefault: boolean; error: string };
  errors: Record<string, string>;
  alerts: unknown[];
  attributions: string[];
}

async function mount(ctx: WebUiPanelContext): Promise<void> {
  const { ui } = ctx;
  let state = await ctx.invoke<State>('state');
  let candidates: CityCandidate[] = [];
  let search = '';
  let adm = '';
  let range = '';
  let message = '';
  let failed = false;
  let settingsMessage = '';
  let settingsFailed = false;
  let searching = false;
  let searchMessage = '';
  let searchFailed = false;

  async function action(method: string, args: unknown[] = []): Promise<unknown> {
    try {
      const result = await ctx.invoke(method, args);
      message = '已完成'; failed = false;
      state = await ctx.invoke<State>('state');
      render(); await ctx.refresh(); return result;
    } catch (error) {
      message = error instanceof Error ? error.message : '操作失败'; failed = true; render();
      return undefined;
    }
  }
  function render(): void {
    const layout = ui.h('div');
    layout.style.cssText = 'display:grid;gap:20px;max-width:960px;margin:auto';
    const sheet = ui.sheet({ title: 'QWeather 连接' });
    const locationSheet = ui.sheet({ title: '地点' });
    const copySheet = ui.sheet({ title: '氛围文案' });
    const settings = ui.foldSheet('weather-settings', { title: '预报与提醒', defaultOpen: false });
    function fieldGrid(): HTMLDivElement {
      const grid = ui.h('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,max(240px,45%)),1fr));gap:4px 24px';
      return grid;
    }
    const intervals = fieldGrid(), daily = fieldGrid(), thresholds = fieldGrid();
    settings.body.style.cssText = 'display:grid;gap:8px';
    const thresholdTitle = ui.section('变化阈值');
    thresholdTitle.style.marginBlock = '8px 0';
    settings.body.append(intervals, daily, thresholdTitle, thresholds);
    layout.append(sheet.el, locationSheet.el, settings.el, copySheet.el);
    const ready = !!state.config.apiHost && state.keySet;
    const buttons = ui.rowbar();
    const keyStatus = ui.pill(state.keySet ? '密钥已配置' : '密钥未配置', state.keySet ? 'on' : 'off');
    const keyInput = ui.input({ type: 'password', cls: 'mono', onCommit: () => saveKey.click() });
    const saveKey = ui.button('保存密钥', { size: 'sm', variant: 'primary', onClick: () => {
      if (keyInput.value.trim()) void action('saveKey', [keyInput.value]);
    } });
    const keyRow = ui.rowbar();
    keyRow.append(keyInput, saveKey);
    const test = ui.button('测试连接', { onClick: () => {
      test.disabled = true; message = '测试中…'; status.textContent = message;
      void action('testConnection').then(result => {
        if (!result) return;
        const output = result as { durationMs: number; errors: Record<string, string> };
        message = `${Object.keys(output.errors).length ? '部分接口失败' : '连接成功'}，${output.durationMs} ms`;
        if (Object.keys(output.errors).length) message += `：${Object.entries(output.errors).map(([k, v]) => `${k} ${v}`).join('；')}`;
        failed = Object.keys(output.errors).length > 0; render();
      });
    } });
    const status = ui.msgline(message, failed);
    test.disabled = !ready || !state.config.location;
    buttons.append(test, status);

    async function save(key: string, value: string | number | boolean): Promise<void> {
      const connection = key === 'apiHost';
      let error = '';
      try {
        await ctx.invoke('save', [key, value]);
        state = await ctx.invoke<State>('state');
      } catch (cause) { error = cause instanceof Error ? cause.message : '保存失败'; }
      if (connection) { message = error || '已保存'; failed = !!error; }
      else { settingsMessage = error || '已保存'; settingsFailed = !!error; }
      render();
    }
    const group = realtimeWeatherConfigGroup(ctx.language);
    for (const [path, property] of Object.entries(group.schema.properties)) {
      if (property.type === 'object') continue;
      const key = path.split('.').at(-1) as keyof RealtimeWeatherConfigSection;
      if (key === 'alignChecksToClock') {
        intervals.after(ui.checkbox(property.title, { checked: state.config[key], onChange: checked => { void save(key, checked); } }).el);
        continue;
      }
      const control = ui.input({ type: property.type === 'string' ? 'text' : 'number', value: String(state.config[key]), onChange: value => {
        if (control.reportValidity()) void save(key, property.type === 'string' ? value.trim() : Number(value));
      } });
      if (key === 'dailyForecastTime') control.type = 'time';
      if (key !== 'apiHost') control.required = true;
      if (property.minimum !== undefined) control.min = String(property.minimum);
      if (property.maximum !== undefined) control.max = String(property.maximum);
      if (control.type === 'number') control.step = property.type === 'integer' ? '1' : 'any';
      if (key === 'apiHost') control.placeholder = '例如 xxxxx.qweatherapi.com';
      const label = property.title + (property['x-suffix'] ? `（${property['x-suffix']}）` : '');
      const parent = key === 'apiHost' ? sheet.body
        : key === 'currentIntervalMinutes' || key === 'forecastIntervalMinutes' ? intervals
        : key === 'dailyForecastTime' || key === 'forecastDays' ? daily : thresholds;
      parent.append(ui.field(label, control));
    }
    if (settingsMessage) settings.body.append(ui.msgline(settingsMessage, settingsFailed));
    sheet.body.append(keyStatus, ui.field('QWeather API Key', keyRow), buttons);
    const help = ui.foldSheet('qweather-registration', { title: '如何取得密钥', defaultOpen: false });
    const registration = ui.h('a', null, '注册QWeather账号'); registration.href = 'https://id.qweather.com/'; registration.target = '_blank'; registration.rel = 'noopener noreferrer';
    help.body.append(registration);
    const steps = ui.h('ol');
    steps.style.cssText = 'padding-left:24px;line-height:1.8';
    for (const text of [
      '注册并登录后，点击进入「开发服务控制台」。',
      '按提示绑定邮箱和手机号。',
      '进入「项目管理」，创建项目；在项目中添加凭据，认证方式选择「API KEY」。',
      '将凭据粘贴到 QWeather API Key 输入框并保存。',
      '进入开发服务控制台的「设置」，找到并复制 API Host，填入上方的「QWeather API Host」。只填主机名，不加 https://。',
      '搜索并选择城市或区划，然后点击「测试连接」。',
    ]) steps.append(ui.h('li', null, text));
    help.body.append(steps, ui.h('p', null, '新建凭据后，如果本扩展和官方 Playground 都返回 401，可等待一段时间后重试。'));
    sheet.body.append(help.el);

    const location = state.config.location;
    locationSheet.body.append(ui.h('p', null, location ? [location.country, location.province, location.city, location.name].filter(Boolean).join(' / ') : '尚未选择城市或区划'));
    async function searchCities(): Promise<void> {
      if (!ready || searching || !search.trim()) return;
      searching = true; candidates = []; searchMessage = '搜索中…'; searchFailed = false; render();
      try {
        candidates = await ctx.invoke<CityCandidate[]>('searchCities', [search.trim(), adm.trim(), range.trim()]);
        searchMessage = candidates.length ? `找到 ${candidates.length} 个地点` : '没有匹配的城市或区划，试试城市名或拼音';
      } catch (error) {
        searchMessage = error instanceof Error ? error.message : '搜索失败'; searchFailed = true;
      } finally { searching = false; render(); }
    }
    const searchButton = ui.button(searching ? '搜索中…' : '搜索', { variant: 'primary', onClick: () => { void searchCities(); } });
    searchButton.disabled = !ready || searching || !search.trim();
    const input = ui.input({ type: 'search', value: search, placeholder: '城市或区划名称', disabled: !ready || searching,
      onInput: value => { search = value; searchButton.disabled = !ready || searching || !value.trim(); },
      onCommit: () => { void searchCities(); } });
    input.setAttribute('aria-label', '搜索城市或区划');
    input.style.cssText = 'flex:1;min-width:160px';
    const searchRow = ui.rowbar();
    searchRow.append(input, searchButton);
    const filters = ui.h('div');
    filters.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px';
    filters.append(
      ui.field('上级行政区（可选）', ui.input({ value: adm, placeholder: '省、州或所属城市', disabled: !ready || searching, onInput: value => { adm = value; }, onCommit: () => { void searchCities(); } })),
      ui.field('国家或地区代码（可选）', ui.input({ value: range, placeholder: 'ISO 国家代码，如 cn、jp、us', disabled: !ready || searching, onInput: value => { range = value; }, onCommit: () => { void searchCities(); } })),
    );
    locationSheet.body.append(filters);
    locationSheet.body.append(searchRow, ui.msgline(!ready ? '请先填写 API Host 并保存密钥，再搜索地点。' : searchMessage, searchFailed));
    for (const city of candidates) {
      const row = ui.rowbar();
      row.style.cssText = 'justify-content:space-between;padding:8px 0';
      row.append(ui.h('span', null, [city.country, city.province, city.city, city.name].filter(Boolean).join(' / ')), ui.button('选择', { onClick: () => {
        void action('selectCity', [city.id]).then(result => { if (result !== undefined) { candidates = []; searchMessage = ''; render(); } });
      } }));
      locationSheet.body.append(row);
    }

    copySheet.body.append(ui.msgline(state.ambience.error ? `正在使用默认文案：${state.ambience.error}` : state.ambience.usingDefault ? '正在使用默认文案' : '正在使用部署文案', !!state.ambience.error));
    const filePath = ui.h('p', 'mono', state.ambience.file);
    filePath.style.cssText = 'overflow-wrap:anywhere;font-size:12px';
    copySheet.body.append(filePath);
    const fileButtons = ui.rowbar();
    fileButtons.append(ui.button('打开文案JSON', { onClick: () => { void action('openAmbience'); } }), ui.button('恢复默认', { onClick: () => { void action('restoreAmbience'); } }));
    copySheet.body.append(fileButtons);
    if (state.config.location && Object.keys(state.errors).length) locationSheet.body.append(ui.msgline(Object.entries(state.errors).map(([k, v]) => `${k}：${v}`).join('；'), true));
    if (state.alerts.length) {
      const alerts = ui.foldSheet('official-alerts', { title: '官方预警原文', defaultOpen: false });
      alerts.body.append(ui.h('pre', null, JSON.stringify(state.alerts, null, 2))); sheet.body.append(alerts.el);
    }
    if (state.attributions.length) {
      const attribution = ui.h('footer');
      attribution.style.cssText = 'font-size:12px;color:var(--ink-soft);overflow-wrap:anywhere';
      attribution.append(ui.h('p', null, '数据来源'));
      for (const item of state.attributions) {
        if (/^https:\/\//.test(item)) {
          const link = ui.h('a', null, item); link.href = item; link.target = '_blank'; link.rel = 'noopener noreferrer'; attribution.append(link, ui.h('br'));
        } else attribution.append(ui.h('p', null, item));
      }
      layout.append(attribution);
    }
    ctx.root.replaceChildren(layout);
  }
  render();
  ctx.interval(() => { void ctx.invoke<State>('state').then(next => { state = next; if (!searching && !ctx.root.contains(ctx.root.ownerDocument.activeElement)) render(); }).catch(() => undefined); }, 5000);
}
export default { panels: { config: { mount } } } satisfies WebUiClientBundle;
