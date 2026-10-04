import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page) {
  await page.route('**/registerSW.js', (route) => route.abort());
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mcp: false } }));
  await page.goto('/');
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('sift');
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction(['feeds', 'items', 'itemFlags', 'meta'], 'readwrite');
    const now = Date.now();
    tx.objectStore('feeds').put({ id: 'bbc', url: 'https://example.com/rss', title: 'BBC News', tags: ['news'], lastFetched: now, learnedIntervalMs: 3600000 });
    tx.objectStore('meta').put({ key: 'settings', value: { theme: 'dark', readFilter: 'unread', focusMode: false } });
    for (let i = 1; i <= 3; i++) {
      const id = `bbc::${i}`;
      tx.objectStore('items').put({ id, feedId: 'bbc', guid: String(i), title: `Article ${i}`, excerpt: 'A short excerpt', html: '<p>Article content to read.</p>', publishedAt: now - i * 1000, updatedAt: now, createdAt: now, read: i === 3, starred: i === 3 });
      tx.objectStore('itemFlags').put({ id, feedId: 'bbc', read: i === 3 ? 1 : 0, starred: i === 3 ? 1 : 0 });
    }
    await new Promise<void>((resolve) => { tx.oncomplete = () => { db.close(); resolve(); }; });
  });
  await page.reload();
  await expect(page.locator('.river-item')).toHaveCount(3);
}

test('desktop filter persists, retains the opened row, restores neighbour focus and reaches caught up', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  const filter = page.locator('.read-filter-floating');
  await expect(filter.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await filter.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(page.locator('.river-item')).toHaveCount(2);
  await page.reload();
  await expect(filter.getByRole('button', { name: 'Unread', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.river-item').first().click();
  await expect(page.locator('.river-item')).toHaveCount(2);
  await expect(page.locator('.river-item').first()).toHaveClass(/read/);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-reading', 'true');
  await expect(page.locator('.river-item')).toHaveCount(2);
  await expect(page.locator('.river-item').first()).toContainText('Article 1');
  await page.screenshot({ path: '/tmp/sift-unread-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.river-item')).toHaveCount(1);
  await expect(page.locator('.river-item.focused')).toContainText('Article 2');
  await page.locator('.river-item').click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('You’re caught up', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show all articles' }).click();
  await expect(page.locator('.river-item')).toHaveCount(3);
});

test('mobile filter occupies the top header and starred bypasses unread mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  const filter = page.locator('.topbar .read-filter');
  await expect(filter).toBeVisible();
  await expect(page.locator('.read-filter-floating')).toBeHidden();
  await filter.getByRole('button', { name: 'Unread' }).click();
  await expect(page.locator('.river-item')).toHaveCount(2);
  await expect(page.locator('.river-item').first()).toContainText('Article 1');
  await page.screenshot({ path: '/tmp/sift-unread-mobile.png' });
  await page.getByRole('button', { name: 'Open feeds sidebar' }).click();
  await page.locator('.sidebar .tag-chips').getByRole('button', { name: 'Toggle starred filter' }).click();
  await expect(page.locator('.river-item')).toHaveCount(1);
  await expect(page.locator('.river-item')).toContainText('Article 3');
  await expect(filter).toHaveCount(0);
});

test('reader keyboard navigation removes the previous read row and stays on eligible articles', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  await page.locator('.read-filter-floating').getByRole('button', { name: 'Unread' }).click();
  await page.locator('.river-item').first().click();
  await page.keyboard.press('j');
  await expect(page.locator('.river-item')).toHaveCount(1);
  await expect(page.locator('.river-item')).toContainText('Article 2');
  await page.keyboard.press('k');
  await expect(page.locator('.river-item')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByText('You’re caught up', { exact: true })).toBeVisible();
});
