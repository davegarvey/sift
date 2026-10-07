import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db/open';
import { upsertFeed, rekeyFeedId, unsubscribeFeed } from '../src/db/feeds';
import {
  bulkUpsertItems,
  deleteItemsByFeed,
  getItem,
  getItemBody,
  insertOrUpdateItem,
  listItems,
  listItemsByFeed,
  listSelectedItems,
  listStarred,
  listUnreadAcrossFeeds,
  saveExtractedHtml,
  searchItems,
  updateItem,
} from '../src/db/items';
import { toServerItems } from '../src/sync/merge';
import type { ItemInput } from '../src/db/types';

function makeInput(overrides: Partial<ItemInput> = {}): ItemInput {
  const feedId = overrides.feedId ?? 'f1';
  const guid = overrides.guid ?? 'g1';
  return {
    id: `${feedId}::${guid}`,
    feedId,
    guid,
    title: 'Title',
    excerpt: 'Excerpt',
    publishedAt: 1000,
    updatedAt: 1000,
    read: false,
    starred: false,
    createdAt: 1000,
    ...overrides,
  };
}

async function storedRecord(id: string): Promise<Record<string, unknown> | undefined> {
  const db = await getDb();
  return db.get('items', id) as Promise<Record<string, unknown> | undefined>;
}

function hasNoBodyFields(item: object): void {
  expect('html' in item).toBe(false);
  expect('extractedHtml' in item).toBe(false);
}

beforeEach(async () => {
  const db = await getDb();
  for (const store of ['feeds', 'items', 'itemBodies', 'itemFlags', 'meta', 'feedStats', 'readMarkers'] as const) {
    await db.clear(store);
  }
});

describe('writing bodies', () => {
  it('writes the body to itemBodies and keeps it off the article record', async () => {
    await insertOrUpdateItem(makeInput({ html: '<p>feed</p>' }));

    hasNoBodyFields((await storedRecord('f1::g1'))!);
    expect(await getItemBody('f1::g1')).toEqual({ id: 'f1::g1', feedId: 'f1', html: '<p>feed</p>' });
  });

  it('writes no body for an entry without feed HTML', async () => {
    await insertOrUpdateItem(makeInput());

    expect(await getItemBody('f1::g1')).toBeUndefined();
    expect(await (await getDb()).count('itemBodies')).toBe(0);
  });

  it('writes bodies for a batch in one call', async () => {
    const inserted = await bulkUpsertItems([
      makeInput({ guid: 'a', html: '<p>a</p>' }),
      makeInput({ guid: 'b' }),
      makeInput({ guid: 'c', html: '<p>c</p>' }),
    ]);

    expect(inserted).toHaveLength(3);
    expect((await (await getDb()).getAll('itemBodies')).map((body) => body.id).sort()).toEqual(['f1::a', 'f1::c']);
  });

  it('replaces the stored html and clears a cached extraction when the feed supplies HTML', async () => {
    await insertOrUpdateItem(makeInput({ html: '<p>old</p>' }));
    await saveExtractedHtml({ id: 'f1::g1', feedId: 'f1' }, '<p>extracted</p>');
    expect(await getItemBody('f1::g1')).toEqual({ id: 'f1::g1', feedId: 'f1', html: '<p>old</p>', extractedHtml: '<p>extracted</p>' });

    await bulkUpsertItems([makeInput({ html: '<p>new</p>' })]);

    expect(await getItemBody('f1::g1')).toEqual({ id: 'f1::g1', feedId: 'f1', html: '<p>new</p>' });
    hasNoBodyFields((await storedRecord('f1::g1'))!);
  });

  it('leaves the stored body unchanged when a refresh has no feed HTML', async () => {
    await insertOrUpdateItem(makeInput({ html: '<p>feed</p>' }));
    await saveExtractedHtml({ id: 'f1::g1', feedId: 'f1' }, '<p>extracted</p>');

    await bulkUpsertItems([makeInput({ title: 'Renamed' })]);

    expect((await getItem('f1::g1'))?.title).toBe('Renamed');
    expect(await getItemBody('f1::g1')).toEqual({ id: 'f1::g1', feedId: 'f1', html: '<p>feed</p>', extractedHtml: '<p>extracted</p>' });
  });

  it('keeps a cached extraction for an article that has no feed HTML', async () => {
    await insertOrUpdateItem(makeInput());
    await saveExtractedHtml({ id: 'f1::g1', feedId: 'f1' }, '<p>extracted</p>');

    await bulkUpsertItems([makeInput()]);

    expect(await getItemBody('f1::g1')).toEqual({ id: 'f1::g1', feedId: 'f1', extractedHtml: '<p>extracted</p>' });
  });

  it('writes a body on a new insertOnly insert and skips an existing article and its body', async () => {
    await insertOrUpdateItem(makeInput({ guid: 'kept', html: '<p>local</p>' }));

    const inserted = await bulkUpsertItems([
      makeInput({ guid: 'kept', title: 'Remote', html: '<p>remote</p>' }),
      makeInput({ guid: 'fresh', html: '<p>fresh</p>' }),
    ], { insertOnly: true });

    expect(inserted).toEqual(['f1::fresh']);
    expect((await getItem('f1::kept'))?.title).toBe('Title');
    expect((await getItemBody('f1::kept'))?.html).toBe('<p>local</p>');
    expect((await getItemBody('f1::fresh'))?.html).toBe('<p>fresh</p>');
  });

  it('stores the HTML of server-polled items from a sync pull', async () => {
    const rows = [
      { seq: 1, feed_id: 'f1', guid: 'polled', title: 'Polled', link: null, author: null, published_at: 500, excerpt: 'e', html: '<p>polled body</p>', thumbnail: null, first_seen_at: 600 },
      { seq: 2, feed_id: 'f1', guid: 'bare', title: 'Bare', link: null, author: null, published_at: 500, excerpt: 'e', html: null, thumbnail: null, first_seen_at: 600 },
    ];

    await bulkUpsertItems(toServerItems(rows, new Set(['f1'])), { insertOnly: true });

    expect(await getItemBody('f1::polled')).toEqual({ id: 'f1::polled', feedId: 'f1', html: '<p>polled body</p>' });
    expect(await getItemBody('f1::bare')).toBeUndefined();
    hasNoBodyFields((await storedRecord('f1::polled'))!);
  });

  it('does not write bodies through updateItem', async () => {
    await insertOrUpdateItem(makeInput({ html: '<p>feed</p>' }));
    await updateItem('f1::g1', { read: true });
    await updateItem('f1::g1', { title: 'Edited' });

    hasNoBodyFields((await storedRecord('f1::g1'))!);
    expect((await getItemBody('f1::g1'))?.html).toBe('<p>feed</p>');
  });
});

describe('saving an extraction', () => {
  it('stores extractedHtml in the body store and keeps feed html', async () => {
    await insertOrUpdateItem(makeInput({ html: '<p>feed</p>' }));
    await saveExtractedHtml({ id: 'f1::g1', feedId: 'f1' }, '<p>extracted</p>');

    expect(await getItemBody('f1::g1')).toEqual({ id: 'f1::g1', feedId: 'f1', html: '<p>feed</p>', extractedHtml: '<p>extracted</p>' });
    hasNoBodyFields((await storedRecord('f1::g1'))!);
  });

  it('creates a body for an article that had none', async () => {
    await insertOrUpdateItem(makeInput());
    await saveExtractedHtml({ id: 'f1::g1', feedId: 'f1' }, '<p>extracted</p>');

    expect(await getItemBody('f1::g1')).toEqual({ id: 'f1::g1', feedId: 'f1', extractedHtml: '<p>extracted</p>' });
  });

  it('creates nothing when the article no longer exists', async () => {
    await saveExtractedHtml({ id: 'f1::gone', feedId: 'f1' }, '<p>extracted</p>');

    expect(await getItemBody('f1::gone')).toBeUndefined();
  });
});

describe('deleting bodies', () => {
  it('deleteItemsByFeed removes the feed’s bodies and keeps other feeds’', async () => {
    await bulkUpsertItems([makeInput({ feedId: 'f1', guid: 'a', html: '<p>a</p>' }), makeInput({ feedId: 'f1', guid: 'b' })]);
    await saveExtractedHtml({ id: 'f1::b', feedId: 'f1' }, '<p>b</p>');
    await bulkUpsertItems([makeInput({ feedId: 'f2', guid: 'c', html: '<p>c</p>' })]);

    await deleteItemsByFeed('f1');

    const db = await getDb();
    expect(await db.getAllFromIndex('itemBodies', 'by-feed-id', 'f1')).toEqual([]);
    expect(await db.getAllFromIndex('items', 'by-feed-published', IDBKeyRange.bound(['f1', -Infinity], ['f1', Infinity]))).toEqual([]);
    expect((await getItemBody('f2::c'))?.html).toBe('<p>c</p>');
  });

  it('unsubscribing a feed removes its bodies', async () => {
    await upsertFeed({ id: 'f1', url: 'https://x.com/feed', title: 'X', learnedIntervalMs: 1, lastFetched: null });
    await bulkUpsertItems([makeInput({ html: '<p>a</p>' })]);

    await unsubscribeFeed('f1');

    expect(await (await getDb()).count('itemBodies')).toBe(0);
  });

  it('rekeyFeedId moves bodies to the new article ids', async () => {
    await upsertFeed({ id: 'old', url: 'https://x.com/feed', title: 'X', learnedIntervalMs: 1, lastFetched: null });
    await bulkUpsertItems([makeInput({ feedId: 'old', guid: 'a::b', html: '<p>a</p>' }), makeInput({ feedId: 'old', guid: 'c' })]);
    await saveExtractedHtml({ id: 'old::c', feedId: 'old' }, '<p>c</p>');

    await rekeyFeedId('old', 'new');

    const db = await getDb();
    const bodies = await db.getAll('itemBodies');
    expect(bodies.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'new::a::b', feedId: 'new', html: '<p>a</p>' },
      { id: 'new::c', feedId: 'new', extractedHtml: '<p>c</p>' },
    ]);
    expect((await listItemsByFeed('new')).map((item) => item.id).sort()).toEqual(['new::a::b', 'new::c']);
  });

  it('rekeyFeedId gives the target’s body precedence when both exist', async () => {
    await upsertFeed({ id: 'old', url: 'https://x.com/feed', title: 'X', learnedIntervalMs: 1, lastFetched: null });
    await bulkUpsertItems([makeInput({ feedId: 'old', guid: 'a', html: '<p>old</p>' })]);
    await bulkUpsertItems([makeInput({ feedId: 'new', guid: 'a', html: '<p>new</p>' })]);
    await saveExtractedHtml({ id: 'old::a', feedId: 'old' }, '<p>extracted</p>');

    await rekeyFeedId('old', 'new');

    expect(await getItemBody('new::a')).toEqual({ id: 'new::a', feedId: 'new', html: '<p>new</p>', extractedHtml: '<p>extracted</p>' });
    expect(await getItemBody('old::a')).toBeUndefined();
  });
});

describe('queries return no bodies', () => {
  beforeEach(async () => {
    await bulkUpsertItems([
      makeInput({ guid: 'a', title: 'Alpha', publishedAt: 3000, html: '<p>needle in the body</p>', starred: true }),
      makeInput({ guid: 'b', title: 'Beta', publishedAt: 2000, html: '<p>beta body</p>' }),
    ]);
    await saveExtractedHtml({ id: 'f1::b', feedId: 'f1' }, '<p>beta extracted</p>');
  });

  it('every list and search function returns metadata only', async () => {
    const results = [
      await listItems(),
      await listItemsByFeed('f1'),
      (await listSelectedItems({ feedIds: new Set(['f1']), unreadOnly: false, starredOnly: false })).items,
      await listUnreadAcrossFeeds(),
      await listStarred(),
      await searchItems('a'),
    ];
    for (const items of results) {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) hasNoBodyFields(item);
    }
  });

  it('search matches the title and excerpt as substrings, not the body', async () => {
    expect((await searchItems('lph')).map((item) => item.guid)).toEqual(['a']);
    expect((await searchItems('xcerp')).map((item) => item.guid).sort()).toEqual(['a', 'b']);
    expect(await searchItems('needle')).toEqual([]);
    expect(await searchItems('extracted')).toEqual([]);
  });
});
