import { test, expect, type Page } from '@playwright/test';

/** Prevent the PWA service worker from registering (it triggers a reload). */
async function disableSw(page: Page) {
  await page.route('**/registerSW.js', (route) => route.abort());
  await page.route('**/sw.js', (route) => route.abort());
  await page.route('**/workbox-*.js', (route) => route.abort());
}

/**
 * Seed a feed and two items into IndexedDB (matching the app's v6 schema),
 * then reload so the app hydrates from the seeded data.
 */
async function seedData(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const feed = {
      id: 'feed-1',
      url: 'https://example.com/feed.xml',
      title: 'Seeded Feed',
      lastFetched: Date.now(),
      learnedIntervalMs: 30 * 60 * 1000,
      etag: null,
      lastModified: null,
      lastError: null,
    };
    const now = Date.now();
    const mkItem = (guid: string, title: string, publishedAt: number) => ({
      id: `feed-1::${guid}`,
      feedId: 'feed-1',
      guid,
      title,
      link: `https://example.com/${guid}`,
      publishedAt,
      updatedAt: publishedAt,
      excerpt: 'Seeded excerpt',
      read: false,
      starred: false,
      createdAt: now,
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sift');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['feeds', 'items'], 'readwrite');
    tx.objectStore('feeds').put(feed);
    tx.objectStore('items').put(mkItem('a', 'Seeded article A', now - 3600_000));
    tx.objectStore('items').put(mkItem('b', 'Seeded article B', now - 7200_000));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  });
}

test.describe('Boot empty-state flash', () => {
  test('returning users see skeletons, never an empty state, while hydrating', async ({ page }) => {
    await disableSw(page);

    // First load creates the IndexedDB schema; then seed data.
    await page.goto('/');
    await page.waitForSelector('.sidebar');
    await seedData(page);
    await page.waitForTimeout(500);

    // Slow the capabilities fetch so the hydration window is observable.
    await page.route('**/api/capabilities', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"mcp":false}' });
    });

    await page.reload();

    // During hydration: skeleton visible, no empty-state headline appears.
    await expect(page.locator('.skeleton-card').first()).toBeVisible();
    await expect(page.locator('.empty-state')).toHaveCount(0);

    // After hydration: stored items render, skeleton and empty state gone.
    await expect(page.locator('.river-item').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.skeleton-card')).toHaveCount(0);
    await expect(page.locator('.empty-state')).toHaveCount(0);
    await expect(page.locator('.river-item .title').filter({ hasText: 'Seeded article A' })).toBeVisible();
  });
});
