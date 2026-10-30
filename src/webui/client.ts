import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { Location, RealtimeWeatherConfigSection } from '../config.ts';
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
  let candidates: Location[] = [];
  let search = '';
  let message = '';
  let failed = false;
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
    const settings = ui.foldSheet('weather-settings', { title: '预报与提醒阈值', defaultOpen: false });
    const settingsGrid = ui.h('div');
    settingsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 24px';
    settings.body.append(settingsGrid);
    layout.append(sheet.el, locationSheet.el, settings.el, copySheet.el);
    const ready = !!state.config.apiHost && state.keySet;
    const buttons = ui.rowbar();
    buttons.append(ui.pill(state.keySet ? '密钥已配置' : '密钥未配置', state.keySet ? 'on' : 'off'));
    buttons.append(ui.button('打开密钥文件', { onClick: () => { void action('openKeyFile'); } }));
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

    const group = realtimeWeatherConfigGroup(ctx.language);
    for (const [path, property] of Object.entries(group.schema.properties)) {
      if (property.type === 'object') continue;
      const key = path.split('.').at(-1) as keyof RealtimeWeatherConfigSection;
      const control = ui.input({ type: property.type === 'string' ? 'text' : 'number', value: String(state.config[key]), onChange: async value => {
        try {
          await ctx.invoke('save', [key, property.type === 'string' ? value.trim() : Number(value)]);
          state = await ctx.invoke<State>('state'); message = '已保存'; failed = false; render();
        } catch (error) { message = error instanceof Error ? error.message : '保存失败'; failed = true; render(); }
      } });
      if (property.minimum !== undefined) control.min = String(property.minimum);
      if (property.maximum !== undefined) control.max = String(property.maximum);
      control.step = property.type === 'integer' ? '1' : 'any';
      if (key === 'apiHost') control.placeholder = '例如 xxxxx.qweatherapi.com';
      (key === 'apiHost' ? sheet.body : settingsGrid).append(ui.field(property.title + (property['x-suffix'] ? ` (${property['x-suffix']})` : ''), control));
    }
    sheet.body.append(buttons);
    const help = ui.foldSheet('qweather-registration', { title: '如何取得密钥', defaultOpen: false });
    const registration = ui.h('a', null, '注册QWeather账号'); registration.href = 'https://id.qweather.com/'; registration.target = '_blank'; registration.rel = 'noopener noreferrer';
    help.body.append(registration, ui.h('p', null, '创建项目并添加 API KEY 凭据。在控制台「设置」复制专属 API Host，填入上方；打开密钥文件，将 API Key 填入 CORTICO_QWEATHER_API_KEY 后保存。选择地点后即可测试连接。'));
    sheet.body.append(help.el);

    const location = state.config.location;
    locationSheet.body.append(ui.h('p', null, location ? [location.country, location.province, location.city, location.name].filter(Boolean).join(' / ') : '尚未选择城市或区划'));
    async function searchCities(): Promise<void> {
      if (!ready || searching || !search.trim()) return;
      searching = true; candidates = []; searchMessage = '搜索中…'; searchFailed = false; render();
      try {
        candidates = await ctx.invoke<Location[]>('searchCities', [search.trim()]);
        searchMessage = candidates.length ? `找到 ${candidates.length} 个地点` : '没有匹配的城市或区划，试试城市名或拼音';
      } catch (error) {
        searchMessage = error instanceof Error ? error.message : '搜索失败'; searchFailed = true;
      } finally { searching = false; render(); }
    }
    const searchButton = ui.button(searching ? '搜索中…' : '搜索', { variant: 'primary', onClick: () => { void searchCities(); } });
    searchButton.disabled = !ready || searching || !search.trim();
    const input = ui.input({ type: 'search', value: search, placeholder: '城市或区划名称，如济南', disabled: !ready || searching,
      onInput: value => { search = value; searchButton.disabled = !ready || searching || !value.trim(); },
      onCommit: () => { void searchCities(); } });
    input.setAttribute('aria-label', '搜索城市或区划');
    input.style.cssText = 'flex:1;min-width:160px';
    const searchRow = ui.rowbar();
    searchRow.append(input, searchButton);
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
      const attribution = ui.foldSheet('attributions', { title: '数据来源', defaultOpen: false });
      for (const item of state.attributions) {
        if (/^https:\/\//.test(item)) {
          const link = ui.h('a', null, item); link.href = item; link.target = '_blank'; link.rel = 'noopener noreferrer'; attribution.body.append(link, ui.h('br'));
        } else attribution.body.append(ui.h('p', null, item));
      }
      sheet.body.append(attribution.el);
    }
    ctx.root.replaceChildren(layout);
  }
  render();
  ctx.interval(() => { void ctx.invoke<State>('state').then(next => { state = next; if (!searching && !ctx.root.contains(ctx.root.ownerDocument.activeElement)) render(); }).catch(() => undefined); }, 5000);
}
export default { panels: { config: { mount } } } satisfies WebUiClientBundle;
