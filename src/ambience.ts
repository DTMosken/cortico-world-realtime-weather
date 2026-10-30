import { existsSync, readFileSync, watchFile, unwatchFile, writeFileSync } from 'node:fs';
import defaults from './ambience.default.json' with { type: 'json' };
import { period } from './time.ts';

export interface AmbienceRule {
  id: string;
  part: 'opening' | 'body' | 'complete';
  when: string[];
  texts: string[];
  priority: number;
}
export interface AmbienceDocument { version: number; rules: AmbienceRule[] }
const DEFAULTS = defaults as AmbienceDocument;

export function parseAmbience(contents: string): AmbienceDocument {
  const doc = JSON.parse(contents) as AmbienceDocument;
  if (doc.version !== 1 || !Array.isArray(doc.rules) || !doc.rules.every(r => typeof r.id === 'string' && ['opening', 'body', 'complete'].includes(r.part) && Array.isArray(r.when) && r.when.every(t => typeof t === 'string') && Array.isArray(r.texts) && r.texts.every(t => typeof t === 'string') && typeof r.priority === 'number')) throw new Error('文案须为version=1和rules列表；每条规则包含id、part、when、texts和priority');
  return doc;
}

export class Ambience {
  private document = DEFAULTS;
  private watching = false;
  error = '';
  usingDefault = true;
  constructor(readonly file: string, private readonly random = Math.random) { this.reload(); }
  reload(): void {
    if (!existsSync(this.file)) { this.document = DEFAULTS; this.error = ''; this.usingDefault = true; return; }
    try { this.document = parseAmbience(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')); this.error = ''; this.usingDefault = false; }
    catch (error) { this.document = DEFAULTS; this.error = error instanceof SyntaxError ? 'JSON语法错误' : error instanceof Error ? error.message : '文案读取失败'; this.usingDefault = true; }
  }
  start(): void {
    if (this.watching) return;
    this.watching = true;
    watchFile(this.file, { interval: 1000, persistent: false }, () => this.reload());
  }
  stop(): void { if (this.watching) unwatchFile(this.file); this.watching = false; }
  restore(): void { writeFileSync(this.file, JSON.stringify(DEFAULTS, null, 2) + '\n'); this.reload(); }
  ensureFile(): void { if (!existsSync(this.file)) this.restore(); }

  private select(part: AmbienceRule['part'], tags: Set<string>): { text: string; when: string[] } | undefined {
    const matches = this.document.rules.filter(r => r.part === part && r.texts.length && r.when.every(t => tags.has(t)));
    const priority = Math.max(...matches.map(r => r.priority));
    const candidates = matches.filter(r => r.priority === priority).flatMap(r => r.texts.map(text => ({ text, when: r.when })));
    return candidates.length ? candidates[Math.floor(this.random() * candidates.length)] : undefined;
  }
  render(kind: 'current' | 'forecast' | 'sunrise' | 'sunset', trigger: 'active' | 'passive', at: string, timezone: string, tags: string[], alertType = '气象'): string {
    const all = new Set([kind, trigger, period(at, timezone), ...tags]);
    const complete = this.select('complete', all);
    if (complete) return `[${complete.text}]`;
    const body = this.select('body', all);
    if (!body) return '';
    const openingKind = body.when.some(t => t.startsWith('alert')) ? 'forecast' : kind;
    const openingTags = new Set([...all].filter(t => t !== kind));
    openingTags.add(openingKind);
    const opening = this.select('opening', openingTags);
    const text = body.text.replace(/\[(台风\/暴雨\/雷电\/大风|暴雨\/大风\/高温)\]/g, alertType);
    return `[${opening?.text ?? ''}${text}]`;
  }
}
