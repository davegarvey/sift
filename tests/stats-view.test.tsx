import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { getDb } from '../src/db/open';
import { upsertFeed } from '../src/db/feeds';
import { upsertFeedStats } from '../src/db/stats';
import { Stats } from '../src/components/Stats';
import type { AppContext } from '../src/state';
import type { AppSettings, StatsSortPreference } from '../src/db/types';

const contextRef = vi.hoisted(() => ({ value: null as AppContext | null }));

vi.mock('../src/state', () => ({
  useApp: () => {
    if (!contextRef.value) throw new Error('test context not set');
    return contextRef.value;
  },
}));

beforeEach(async () => {
  const db = await getDb();
  await db.clear('feeds');
  await db.clear('feedStats');
  await db.clear('readMarkers');
  await db.clear('items');
  await db.clear('itemFlags');
  await db.clear('meta');
  document.body.innerHTML = '';
});

describe('stats view', () => {
  it('renders local-only statistics without sync', async () => {
    const feed = {
      id: 'view-feed',
      url: 'https://example.com/view.xml',
      title: 'View Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    };
    await upsertFeed(feed);
    await upsertFeedStats({
      feedId: feed.id,
      totalSeen: 10,
      readOnce: 3,
      serverReadOnce: 0,
      title: feed.title,
      url: feed.url,
    });
    contextRef.value = {
      hydrated: () => true,
      statsRevision: () => 0,
      syncKey: () => null,
      settings: () => ({ statsSort: { column: 'readOnce', direction: 'desc' } }),
      saveSettingsPatch: async () => {},
    } as unknown as AppContext;
    const dispose = render(() => <Stats />, document.body);
    await vi.waitFor(() => expect(document.body.textContent).toContain('View Feed'));
    expect(document.querySelector('.stats-kicker')?.textContent).toContain('Stats');
    expect(document.body.textContent).toContain('Your reading habits');
    expect(document.body.textContent).toContain('Find your favourite feeds and see how much you read from each.');
    expect(document.body.textContent).not.toContain('See which feeds you come back to most');
    expect(document.body.textContent).toContain('Your stats stay on this device and work offline.');
    expect(document.body.textContent).toContain('Articles');
    expect(document.body.textContent).toContain('Reading rate');
    expect(document.body.textContent).not.toContain('Observed volume');
    expect(document.body.textContent).not.toContain('read-once');
    expect(document.querySelectorAll('.stats-value span')).toHaveLength(0);
    const help = document.querySelector<HTMLButtonElement>('[aria-label="How these numbers work"]');
    expect(help?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.stats-page-heading .stats-help-button')).toBe(help);
    const headingTop = document.querySelector('.stats-heading-top');
    expect(headingTop?.querySelector('.stats-kicker')).not.toBeNull();
    expect(headingTop?.querySelector('.stats-help-button')).toBe(help);
    expect(document.querySelector('.stats-list-heading .stats-help-button')).toBeNull();
    help?.click();
    expect(help?.getAttribute('aria-expanded')).toBe('true');
    await Promise.resolve();
    const dialog = document.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(dialog);
    expect(help?.parentElement?.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog?.textContent).toContain('Distinct articles Sift encountered');
    expect(dialog?.textContent).toContain('not your current unread list');
    document.querySelector<HTMLButtonElement>('[aria-label="Close stats explanation"]')?.click();
    expect(help?.getAttribute('aria-expanded')).toBe('false');
    dispose();
  });

  it('explains synced article totals without exposing implementation terms', async () => {
    const feed = {
      id: 'synced-view-feed',
      url: 'https://example.com/synced.xml',
      title: 'Synced Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    };
    await upsertFeed(feed);
    await upsertFeedStats({
      feedId: feed.id,
      totalSeen: 10,
      readOnce: 3,
      serverReadOnce: 3,
      title: feed.title,
      url: feed.url,
    });
    contextRef.value = {
      hydrated: () => true,
      statsRevision: () => 0,
      syncKey: () => 'sync-key',
      settings: () => ({ statsSort: { column: 'readOnce', direction: 'desc' } }),
      saveSettingsPatch: async () => {},
    } as unknown as AppContext;
    const dispose = render(() => <Stats />, document.body);
    await vi.waitFor(() => expect(document.body.textContent).toContain('Synced Feed'));
    expect(document.body.textContent).not.toContain('Across devices, article totals are estimates; each article counts as read only once.');
    expect(document.body.textContent).not.toContain('observed volume');
    const help = document.querySelector<HTMLButtonElement>('[aria-label="How these numbers work"]');
    help?.click();
    await Promise.resolve();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('article totals are estimates across devices');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(help?.getAttribute('aria-expanded')).toBe('false');
    dispose();
  });

  it('sorts from headings and restores the local preference', async () => {
    const first = {
      id: 'first-view-feed',
      url: 'https://example.com/first-view.xml',
      title: 'First View Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    };
    const second = {
      id: 'second-view-feed',
      url: 'https://example.com/second-view.xml',
      title: 'Second View Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    };
    await upsertFeed(first);
    await upsertFeed(second);
    await upsertFeedStats({
      feedId: first.id,
      totalSeen: 100,
      readOnce: 20,
      serverReadOnce: 0,
      title: first.title,
      url: first.url,
    });
    await upsertFeedStats({
      feedId: second.id,
      totalSeen: 10,
      readOnce: 1,
      serverReadOnce: 0,
      title: second.title,
      url: second.url,
    });

    const [savedSort, setSavedSort] = createSignal<StatsSortPreference>({ column: 'readOnce', direction: 'desc' });
    const saveSettingsPatch = vi.fn(async (patch: Partial<AppSettings>) => {
      if (patch.statsSort) setSavedSort(patch.statsSort);
    });
    contextRef.value = {
      hydrated: () => true,
      statsRevision: () => 0,
      syncKey: () => null,
      settings: () => ({ statsSort: savedSort() }),
      saveSettingsPatch,
    } as unknown as AppContext;

    const dispose = render(() => <Stats />, document.body);
    await vi.waitFor(() => expect(document.querySelectorAll('.stats-row')).toHaveLength(2));

    const feedIds = () => [...document.querySelectorAll<HTMLElement>('.stats-feed strong')].map((element) => element.textContent);
    expect(feedIds()).toEqual(['First View Feed', 'Second View Feed']);
    const readButton = document.querySelector<HTMLButtonElement>('[data-sort-column="readOnce"]');
    const rateButton = document.querySelector<HTMLButtonElement>('[data-sort-column="readRate"]');
    expect(readButton?.parentElement?.getAttribute('aria-sort')).toBe('descending');
    rateButton?.click();
    expect(feedIds()).toEqual(['First View Feed', 'Second View Feed']);
    expect(saveSettingsPatch).toHaveBeenLastCalledWith({ statsSort: { column: 'readRate', direction: 'desc' } });
    expect(rateButton?.parentElement?.getAttribute('aria-sort')).toBe('descending');
    rateButton?.click();
    expect(feedIds()).toEqual(['Second View Feed', 'First View Feed']);
    expect(saveSettingsPatch).toHaveBeenLastCalledWith({ statsSort: { column: 'readRate', direction: 'asc' } });
    expect(rateButton?.parentElement?.getAttribute('aria-sort')).toBe('ascending');

    const mobileColumn = document.querySelector('[aria-label="Stats sort column"]') as HTMLSelectElement | null;
    const mobileDirection = document.querySelector('[aria-label="Stats sort direction"]') as HTMLSelectElement | null;
    expect(mobileColumn?.value).toBe('readRate');
    expect(mobileDirection?.value).toBe('asc');
    mobileColumn!.value = 'title';
    mobileColumn!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(savedSort()).toEqual({ column: 'title', direction: 'asc' });

    dispose();
    document.body.innerHTML = '';
    const secondDispose = render(() => <Stats />, document.body);
    await vi.waitFor(() => expect(document.querySelector('[data-sort-column="title"]')?.parentElement?.getAttribute('aria-sort')).toBe('ascending'));
    expect(feedIds()).toEqual(['First View Feed', 'Second View Feed']);
    secondDispose();
  });
});
