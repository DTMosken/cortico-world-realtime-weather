import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Ambience } from '../src/ambience.ts';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function create() {
  const dir = mkdtempSync(join(tmpdir(), 'ambience-')); directories.push(dir);
  const file = join(dir, 'ambience.json');
  return { file, copy: new Ambience(file, () => 0) };
}
describe('demo文案与部署覆盖', () => {
  it('开始下雨按demo拼装；日间UV跨级匹配普通及极值候选', () => {
    const { copy } = create();
    const text = copy.render('current', 'passive', '2026-10-31T14:15:00Z', 'UTC', ['rainStarted']);
    expect(text).toBe('[正忙着，余光瞥见屋里的光线变了，下意识抬头望向窗外，空气里的湿气重了起来，雨点开始啪嗒啪嗒地砸在窗户上，赶紧起身把窗关小了些。]');
    expect(copy.render('current', 'passive', '2026-10-31T14:15:00Z', 'UTC', ['uvUp'])).toBe('');
    expect(copy.render('current', 'passive', '2026-10-31T14:15:00Z', 'UTC', ['uvUp', 'daylight'])).toContain('需要注意防晒');
    expect(copy.render('current', 'passive', '2026-10-31T14:15:00Z', 'UTC', ['uvUp', 'highUv', 'daylight'])).toContain('外面的阳光变得格外毒辣');
  });
  it('损坏JSON整份回退，保留损坏文件；一键恢复写回默认', () => {
    const { file, copy } = create();
    writeFileSync(file, '{broken'); copy.reload();
    expect(copy.usingDefault).toBe(true); expect(copy.error).toBeTruthy(); expect(readFileSync(file, 'utf8')).toBe('{broken');
    expect(copy.render('current', 'active', '2026-10-31T12:00:00Z', 'UTC', ['lightRain'])).toContain('外面飘着细密的雨丝');
    copy.restore(); expect(copy.usingDefault).toBe(false); expect(copy.error).toBe(''); expect(JSON.parse(readFileSync(file, 'utf8')).rules.length).toBeGreaterThan(0);
  });
  it('结构无效也回退；空候选允许稍后补充', () => {
    const { file, copy } = create();
    writeFileSync(file, JSON.stringify({ version: 1, rules: [{ id: 'pending', part: 'body', when: ['uvUp'], texts: [], priority: 10 }] })); copy.reload();
    expect(copy.error).toBe(''); expect(copy.render('current', 'active', '2026-10-31T12:00:00Z', 'UTC', ['uvUp'])).toBe('');
    writeFileSync(file, JSON.stringify({ version: 1, rules: [{ id: 'bad' }] })); copy.reload(); expect(copy.usingDefault).toBe(true); expect(copy.error).toBeTruthy();
  });
  it('手动保存后自动重载，修复后清除错误', async () => {
    const { file, copy } = create();
    writeFileSync(file, '{'); copy.reload(); copy.start();
    try {
      writeFileSync(file, JSON.stringify({ version: 1, rules: [{ id: 'custom', part: 'body', when: ['custom'], texts: ['用户提供的原句。'], priority: 1 }] }));
      await new Promise(resolve => setTimeout(resolve, 1300));
      expect(copy.error).toBe(''); expect(copy.render('current', 'active', '2026-10-31T12:00:00Z', 'UTC', ['custom'])).toBe('[用户提供的原句。]');
    } finally { copy.stop(); }
  });
  it('预警降级使用补充原句；不与解除混用', () => {
    const { copy } = create();
    const text = copy.render('current', 'passive', '2026-10-31T12:00:00Z', 'UTC', ['alertDowngraded']);
    expect(text).toContain('预警信号降级了，外面的风声雨势也确实没有预想中那么吓人了，稍微松了一口气。');
    expect(text).not.toContain('总算解除了');
  });
  it('通用占位符与选中的预警变化对应，支持清单外类型', () => {
    const { copy } = create();
    const text = copy.render('current', 'passive', '2026-10-31T12:00:00Z', 'UTC', ['alertAdded', 'alertCancelled'], { alertAdded: '大风', alertCancelled: '道路结冰' });
    expect(text).toContain('道路结冰预警总算解除了');
    expect(text).not.toMatch(/\{alertType\}|大风预警/);
    expect(copy.render('current', 'passive', '2026-10-31T12:00:00Z', 'UTC', ['alertUpgraded'], { alertUpgraded: '洪水' })).toContain('洪水预警信号升级');
  });
  it('新增夜间和雪势文案保持原句', () => {
    const { copy } = create();
    expect(copy.render('current', 'passive', '2026-10-31T22:00:00Z', 'UTC', ['becameClear', 'dark'])).toContain('夜空中的云层散开了，清冷的月光重新漏了下来，给窗台镀上了一层淡淡的银白。');
    expect(copy.render('current', 'passive', '2026-10-31T12:00:00Z', 'UTC', ['snowWeaker'])).toContain('漫天飞舞的雪花渐渐稀疏了下来，只剩下零星的雪粒还在空中打着旋儿。');
  });
  it('天气句和预警句同时保留，预警句始终置后', () => {
    const { copy } = create();
    const text = copy.render('current', 'passive', '2026-10-31T14:15:00Z', 'UTC', ['rainStarted', 'alertAdded'], { alertAdded: '暴雨' });
    expect(text).toContain('雨点开始啪嗒啪嗒地砸在窗户上');
    expect(text).toContain('刚挂出了暴雨预警');
    expect(text.indexOf('刚挂出了暴雨预警')).toBeGreaterThan(text.indexOf('雨点开始'));
    expect(text).toContain('听到手机震了一下，低头扫了一眼弹出的提醒，');
    expect(text.match(/\[/g)).toHaveLength(1);
  });
  it('通用视程句只在没有专用条件时选中', () => {
    const { file } = create();
    const copy = new Ambience(file, () => 0.999);
    const render = (tags: string[]) => copy.render('current', 'passive', '2026-10-31T12:00:00Z', 'UTC', tags);
    expect(render(['visibilityUp', 'fogPresent'])).toContain('空气里依然还飘着一层薄薄的雾');
    expect(render(['visibilityUp', 'wasWaterFog'])).toContain('浓雾终于散开');
    expect(render(['visibilityDown', 'waterFog'])).toContain('白茫茫的水汽');
    expect(render(['visibilityDown', 'noFog'])).toContain('景物的边缘');
    expect(render(['visibilityUp'])).toContain('之前看着有些模糊的远处景物');
    expect(render(['visibilityDown'])).toContain('稍远一点的建筑和街景');
  });
  it('UV极值候选在随机数接近1时也优先于普通句', () => {
    const { file } = create();
    const copy = new Ambience(file, () => 0.999);
    expect(copy.render('current', 'passive', '2026-10-31T12:00:00Z', 'UTC', ['uvUp', 'highUv', 'daylight'])).toContain('格外毒辣');
    expect(copy.render('current', 'passive', '2026-10-31T12:00:00Z', 'UTC', ['uvDown', 'lowUv', 'daylight'])).toContain('光线变得柔和舒适');
    expect(copy.render('current', 'passive', '2026-10-31T12:00:00Z', 'UTC', ['uvDown', 'daylight'])).toContain('伸手拉开窗帘');
  });
});
