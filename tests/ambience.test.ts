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
  it('开始下雨按demo拼装；纯UV未达到补充条件时只发数据', () => {
    const { copy } = create();
    const text = copy.render('current', 'passive', '2026-10-31T14:15:00Z', 'UTC', ['rainStarted']);
    expect(text).toBe('[正忙着，余光瞥见屋里的光线变了，下意识抬头望向窗外，空气里的湿气重了起来，雨点开始啪嗒啪嗒地砸在窗户上，赶紧起身把窗关小了些。]');
    expect(copy.render('current', 'passive', '2026-10-31T14:15:00Z', 'UTC', ['uvUp'])).toBe('');
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
});
