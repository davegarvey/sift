import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEviction } from '../src/articles/eviction';
import { getDb } from '../src/db/open';
import { EVICTION_CHUNK_SIZE, STORAGE_SOFT_CAP_RATIO } from '../src/db/types';
import type { Item } from '../src/db/types';

const FEED_ID = 'https://example.com/feed.xml';
const QUOTA = 1_000_000;
const SOFT_CAP = QUOTA * STORAGE_SOFT_CAP_RATIO;
const HTML = 'x'.repeat(1000);

function makeItem(guid: string, overrides: Partial<Item> = {}): Item {
  const publishedAt = 1_700_000_000_000;
  return {
    id: `${FEED_ID}::${guid}`,
    feedId: FEED_ID,
    guid,
    title: `Item ${guid}`,
    link: `https://example.com/${guid}`,
    excerpt: 'excerpt',
    html: '<p>summary</p>',
    thumbnail: null,
    publishedAt,
    updatedAt: publishedAt,
    createdAt: publishedAt,
    read: true,
    starred: false,
    extractedHtml: HTML,
    firstOpenedAt: null,
    ...overrides,
  };
}

function stubEstimate(estimate: StorageEstimate | null): void {
  vi.stubGlobal('navigator', estimate === null ? {} : { storage: { estimate: async () => estimate } });
}

async function putItems(items: Item[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('items', 'readwrite');
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

async function evictedGuids(): Promise<string[]> {
  const db = await getDb();
  const items = await db.getAll('items');
  return items.filter((item) => item.extractedHtml == null).map((item) => item.guid).sort();
}

const opened = [
  makeItem('a', { firstOpenedAt: 1000 }),
  makeItem('b', { firstOpenedAt: 3000 }),
  makeItem('c', { firstOpenedAt: 2000 }),
  makeItem('never'),
];

beforeEach(async () => {
  const db = await getDb();
  await db.clear('items');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runEviction', () => {
  it('does nothing when usage is at the soft cap', async () => {
    await putItems(opened);
    stubEstimate({ quota: QUOTA, usage: SOFT_CAP });

    await runEviction();

    expect(await evictedGuids()).toEqual([]);
  });

  it.each([
    ['the Storage API is unavailable', null],
    ['no quota is reported', { quota: 0, usage: QUOTA }],
    ['no usage is reported', { quota: QUOTA, usage: 0 }],
  ])('does nothing when %s', async (_label, estimate: StorageEstimate | null) => {
    await putItems(opened);
    stubEstimate(estimate);

    await runEviction();

    expect(await evictedGuids()).toEqual([]);
  });

  it('clears the earliest-opened articles until the excess is covered', async () => {
    await putItems(opened);
    stubEstimate({ quota: QUOTA, usage: SOFT_CAP + 1500 });

    await runEviction();

    expect(await evictedGuids()).toEqual(['a', 'c']);
  });

  it('clears articles without an open time only after every opened article', async () => {
    await putItems(opened);
    stubEstimate({ quota: QUOTA, usage: SOFT_CAP + 3000 });

    await runEviction();

    expect(await evictedGuids()).toEqual(['a', 'b', 'c']);
  });

  it('skips items without extracted HTML', async () => {
    await putItems([
      makeItem('plain', { firstOpenedAt: 500, extractedHtml: null }),
      makeItem('a', { firstOpenedAt: 1000 }),
      makeItem('b', { firstOpenedAt: 2000 }),
    ]);
    stubEstimate({ quota: QUOTA, usage: SOFT_CAP + 500 });

    await runEviction();

    expect(await evictedGuids()).toEqual(['a', 'plain']);
  });

  it('keeps item metadata when clearing extracted HTML', async () => {
    const item = makeItem('a', { firstOpenedAt: 1000, starred: true, author: 'Author' });
    await putItems([item]);
    stubEstimate({ quota: QUOTA, usage: SOFT_CAP + 1 });

    await runEviction();

    const db = await getDb();
    expect(await db.get('items', item.id)).toEqual({ ...item, extractedHtml: null });
    expect(await db.count('items')).toBe(1);
  });

  it('writes in chunks of the configured size', async () => {
    const count = EVICTION_CHUNK_SIZE * 2 + 200;
    await putItems(Array.from({ length: count }, (_, i) => makeItem(`item-${i}`, { firstOpenedAt: i + 1, extractedHtml: 'x' })));
    stubEstimate({ quota: QUOTA, usage: QUOTA });
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');

    await runEviction();

    const writes = transaction.mock.calls.filter(([, mode]) => mode === 'readwrite');
    expect(writes).toHaveLength(3);
    expect((await evictedGuids()).length).toBe(count);
  });
});
