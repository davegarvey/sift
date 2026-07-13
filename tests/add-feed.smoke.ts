import { test, expect } from '@playwright/test';

const MOCK_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>A test feed for smoke testing</description>
    <item>
      <title>First article</title>
      <link>https://example.com/1</link>
      <guid>guid-1</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second article</title>
      <link>https://example.com/2</link>
      <guid>guid-2</guid>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

test.describe('Add feed', () => {
  test('subscribing to a feed shows it in the sidebar and creates a sync queue entry', async ({ page }) => {
    // Intercept the proxy endpoint so discovery returns our mock RSS.
    await page.route(
      (url) => url.pathname === '/feed',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/rss+xml',
          body: MOCK_RSS,
        });
      },
    );

    await page.goto('/');
    // Wait for the app to render the sidebar.
    await page.waitForSelector('.sidebar');

    // Click the "+ Add feed" button.
    await page.getByRole('button', { name: 'Add feed' }).click();
    // Wait for the modal.
    await page.waitForSelector('.modal.add-feed');

    // Type a feed URL.
    await page.locator('.add-feed input[type="url"]').fill('https://example.com/blog');
    // Click "Discover".
    await page.getByRole('button', { name: 'Discover' }).click();
    // Wait for the feed preview to appear (shows the feed title).
    await expect(page.locator('.samples')).toContainText('Test Feed');
    // Click "Subscribe".
    await page.getByRole('button', { name: 'Subscribe' }).click();
    // Wait for the modal to close.
    await page.waitForSelector('.modal.add-feed', { state: 'detached' });

    // Verify the feed appears in the sidebar.
    const feedTitle = page.locator('.sidebar .feed .title').filter({ hasText: 'Test Feed' });
    await expect(feedTitle).toBeVisible();

    // Wait for the sync dirty queue to be persisted to IndexedDB (200ms debounce).
    await page.waitForTimeout(500);

    // Verify a feed-upsert entry was persisted to IndexedDB meta.
    const dirty = await page.evaluate(async () => {
      const req = indexedDB.open('sift', 3);
      return new Promise((resolve, reject) => {
        req.onsuccess = () => {
          const tx = req.result.transaction('meta', 'readonly');
          const store = tx.objectStore('meta');
          const get = store.get('sync_dirty');
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    expect(dirty).toBeDefined();
    const entries: unknown[] = (dirty as { key: string; value: unknown[] }).value;
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'feed-upsert',
          feedUrl: 'https://example.com/blog',
        }),
      ]),
    );
  });
});
