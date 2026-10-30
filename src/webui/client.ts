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
    const sheet = ui.sheet({ title: '实时天气' });
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
    buttons.append(test, status); sheet.body.append(buttons);

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
      sheet.body.append(ui.field(property.title + (property['x-suffix'] ? ` (${property['x-suffix']})` : ''), control));
    }
    const help = ui.foldSheet('qweather-registration', { title: '如何取得密钥', defaultOpen: false });
    const registration = ui.h('a', null, '注册QWeather账号'); registration.href = 'https://id.qweather.com/'; registration.target = '_blank'; registration.rel = 'noopener noreferrer';
    help.body.append(registration, ui.h('p', null, '创建项目，添加API KEY凭据。在控制台设置复制API Host；打开密钥文件，将API Key填入CORTICO_QWEATHER_API_KEY后保存。'));
    sheet.body.append(help.el);

    const location = state.config.location;
    sheet.body.append(ui.section('地点'), ui.h('p', null, location ? [location.country, location.province, location.city, location.name].filter(Boolean).join(' / ') : '尚未选择城市或区划'));
    const input = ui.input({ value: search, placeholder: '输入城市或区划名称' });
    const searchRow = ui.rowbar();
    searchRow.append(input, ui.button('搜索', { onClick: () => {
      search = input.value;
      void action('searchCities', [search]).then(result => { if (Array.isArray(result)) { candidates = result as Location[]; message = candidates.length ? '' : '没有匹配的城市或区划'; render(); } });
    } }));
    sheet.body.append(searchRow);
    for (const city of candidates) {
      const row = ui.rowbar();
      row.append(ui.h('span', null, [city.country, city.province, city.city, city.name].filter(Boolean).join(' / ')), ui.button('选择', { onClick: () => { void action('selectCity', [city.id]); } }));
      sheet.body.append(row);
    }

    sheet.body.append(ui.section('氛围文案'), ui.h('p', 'mono', state.ambience.file));
    sheet.body.append(ui.msgline(state.ambience.error ? `正在使用默认文案：${state.ambience.error}` : state.ambience.usingDefault ? '正在使用默认文案' : '正在使用部署文案', !!state.ambience.error));
    const fileButtons = ui.rowbar();
    fileButtons.append(ui.button('打开文案JSON', { onClick: () => { void action('openAmbience'); } }), ui.button('恢复默认', { onClick: () => { void action('restoreAmbience'); } }));
    sheet.body.append(fileButtons);
    if (Object.keys(state.errors).length) sheet.body.append(ui.msgline(Object.entries(state.errors).map(([k, v]) => `${k}：${v}`).join('；'), true));
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
    ctx.root.replaceChildren(sheet.el);
  }
  render();
  ctx.interval(() => { void ctx.invoke<State>('state').then(next => { state = next; if (!ctx.root.contains(ctx.root.ownerDocument.activeElement)) render(); }).catch(() => undefined); }, 5000);
}
export default { panels: { config: { mount } } } satisfies WebUiClientBundle;
