import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function ensureParent(file: string): void { mkdirSync(dirname(file), { recursive: true }); }
export function openFile(file: string): Promise<void> {
  const command = process.platform === 'win32' ? 'notepad.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(command, [file], { detached: true, stdio: 'ignore' });
    child.once('error', () => reject(new Error('无法打开本机文件')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
