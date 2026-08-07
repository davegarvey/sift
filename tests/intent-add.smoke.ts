import { test, expect } from '@playwright/test';

test.describe('Agent intent: add feed', () => {
  test('?intent=add&url= opens the modal prefilled, no auto-fetch, cleans the address bar', async ({ page }) => {
    let feedRequests = 0;
    await page.route(
      (url) => url.pathname === '/feed',
      async (route) => {
        feedRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/rss+xml',
          body: '<rss><channel><title>X</title></channel></rss>',
        });
      },
    );

    const target = 'https://example.com/blog';
    await page.goto(`/?intent=add&url=${encodeURIComponent(target)}`);
    await page.waitForSelector('.modal.add-feed');

    // Prefilled with the raw value, passed through unvalidated.
    await expect(page.locator('.add-feed input[type="url"]')).toHaveValue(target);

    // No fetch is fired as a side effect of loading.
    expect(feedRequests).toBe(0);

    // The intent parameters are cleaned from the address bar.
    await expect.poll(() => page.url()).not.toContain('intent');

    // Discovery still runs on user click.
    await page.getByRole('button', { name: 'Discover' }).click();
    await expect.poll(() => feedRequests).toBeGreaterThan(0);
  });

  test('?intent=add without url opens the modal empty', async ({ page }) => {
    await page.goto('/?intent=add');
    await page.waitForSelector('.modal.add-feed');
    await expect(page.locator('.add-feed input[type="url"]')).toHaveValue('');
    await expect.poll(() => page.url()).not.toContain('intent');
  });

  test('non-http(s) intent value surfaces the existing validation error on discover', async ({ page }) => {
    await page.goto('/?intent=add&url=javascript%3Aalert(1)');
    await page.waitForSelector('.modal.add-feed');
    await expect(page.locator('.add-feed input[type="url"]')).toHaveValue('javascript:alert(1)');
    // The modal's existing validation gate applies to the prefilled value;
    // Discover stays disabled and the error is shown.
    await expect(page.locator('.add-feed .error')).toContainText('http');
    await expect(page.getByRole('button', { name: 'Discover' })).toBeDisabled();
  });
});
