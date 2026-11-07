import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
export const runtimeRoot = process.env.DIMA_BACKEND_ROOT || resolve(homedir(), '.local/state/dima-b0');
export const clientEnvPath = resolve(runtimeRoot, 'client.env');
export function readEnv(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter((line) => line && !line.startsWith('#')).map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
}
