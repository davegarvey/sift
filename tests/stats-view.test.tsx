import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { getDb } from '../src/db/open';
import { upsertFeed } from '../src/db/feeds';
import { upsertFeedStats } from '../src/db/stats';
import { Stats } from '../src/components/Stats';
import type { AppContext } from '../src/state';

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
    } as unknown as AppContext;
    const dispose = render(() => <Stats />, document.body);
    await vi.waitFor(() => expect(document.body.textContent).toContain('View Feed'));
    expect(document.body.textContent).toContain('It stays on this device and works offline.');
    expect(document.body.textContent).toContain('3 / 10');
    dispose();
  });
});
