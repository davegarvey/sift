import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientIp } from '../server/sync/auth';

describe('sync client address', () => {
  const app = new Hono().get('/', (c) => c.text(clientIp(c)));

  it('uses Cloudflare’s visitor address when present', async () => {
    const response = await app.request('/', {
      headers: {
        'CF-Connecting-IP': '192.0.2.10',
        'X-Forwarded-For': '203.0.113.1',
      },
    });

    expect(await response.text()).toBe('192.0.2.10');
  });

  it('ignores client-supplied X-Forwarded-For when Cloudflare address is absent', async () => {
    const first = await app.request('/', { headers: { 'X-Forwarded-For': '203.0.113.1' } });
    const second = await app.request('/', { headers: { 'X-Forwarded-For': '203.0.113.2' } });

    expect(await first.text()).toBe('0.0.0.0');
    expect(await second.text()).toBe('0.0.0.0');
  });
});
