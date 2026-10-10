import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess | undefined;

test.beforeAll(async () => {
  execFileSync('npm', ['run', 'build'], { stdio: 'ignore' });
  server = spawn('npx', ['tsx', 'server/node.ts'], {
    env: { ...process.env, PORT: String(PORT), SIFT_DATA_DIR: mkdtempSync(join(tmpdir(), 'sift-sw-')) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/`)).ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('server did not start');
});

test.afterAll(() => {
  server?.kill();
});

test('the service worker leaves OAuth navigations to the server and serves the consent page', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const oauth = await page.goto(`${BASE}/oauth/authorize?client_id=unknown&response_type=code`);
  expect(oauth?.status()).toBe(400);
  expect(await oauth?.text()).not.toContain('id="root"');

  const wellKnown = await page.goto(`${BASE}/.well-known/oauth-authorization-server`);
  expect(wellKnown?.headers()['content-type']).toContain('json');

  await page.goto(`${BASE}/connect`);
  await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
});
