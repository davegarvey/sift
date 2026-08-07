import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_URL = 'https://sift.davegarvey.workers.dev';

export function baseUrl(): string {
  return (process.env.SIFTCTL_URL ?? DEFAULT_URL).replace(/\/+$/, '');
}

export function tokenPath(): string {
  const home = process.env.SIFTCTL_HOME ?? path.join(homedir(), '.config');
  return path.join(home, 'siftctl', 'token');
}

/** Token precedence: SIFTCTL_TOKEN env, then the config file. */
export function readToken(): string | null {
  const env = process.env.SIFTCTL_TOKEN;
  if (env) return env;
  try {
    const value = readFileSync(tokenPath(), 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeToken(token: string): void {
  const p = tokenPath();
  mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, token + '\n', { mode: 0o600 });
  chmodSync(p, 0o600);
}
