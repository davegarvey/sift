// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { openDB } from 'idb';
import { DB_NAME } from '../src/db/types';

const extractArticle = vi.hoisted(() => vi.fn());

vi.mock('../src/articles/extract', () => ({ extractArticle }));

async function seedVersion9(): Promise<void> {
  const db = await openDB(DB_NAME, 9, {
    upgrade(upgrading) {
      upgrading.createObjectStore('feeds', { keyPath: 'id' }).createIndex('by-url', 'url');
      const items = upgrading.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('by-feed-published', ['feedId', 'publishedAt']);
      items.createIndex('by-guid', 'guid');
      items.createIndex('by-published', 'publishedAt');
      const flags = upgrading.createObjectStore('itemFlags', { keyPath: 'id' });
      flags.createIndex('by-read', 'read');
      flags.createIndex('by-starred', 'starred');
      flags.createIndex('by-feed-id', 'feedId');
      upgrading.createObjectStore('meta', { keyPath: 'key' });
      upgrading.createObjectStore('feedStats', { keyPath: 'feedId' });
      const markers = upgrading.createObjectStore('readMarkers', { keyPath: 'id' });
      markers.createIndex('by-feed-id', 'feedId');
      markers.createIndex('by-acknowledged', 'acknowledged');
    },
  });
  await db.put('items', {
    id: 'f1::old',
    feedId: 'f1',
    guid: 'old',
    title: 'Old article',
    excerpt: 'Old excerpt',
    link: 'https://example.com/old',
    publishedAt: 1000,
    updatedAt: 1000,
    createdAt: 900,
    read: true,
    starred: false,
    html: '<p>Feed copy that will be dropped</p>',
    extractedHtml: '<p>Extraction that will be dropped</p>',
  });
  db.close();
}

describe('an article migrated from version 9', () => {
  it('has no body and is extracted again on first open', async () => {
    await seedVersion9();
    extractArticle.mockResolvedValue({ html: '<p>Fresh extraction</p>' });
    const { getDb } = await import('../src/db/open');
    const { getItem, getItemBody } = await import('../src/db/items');
    const { openItemForReading } = await import('../src/articles/service');

    expect((await getDb()).version).toBe(10);
    expect(await getItemBody('f1::old')).toBeUndefined();
    expect(await getItem('f1::old')).toMatchObject({ title: 'Old article', read: true });

    const result = await openItemForReading('f1::old');

    expect(extractArticle).toHaveBeenCalledWith('https://example.com/old', undefined);
    expect(result.bodyHtml).toContain('Fresh extraction');
    expect(result.bodyHtml).not.toContain('dropped');
    expect(await getItemBody('f1::old')).toEqual({ id: 'f1::old', feedId: 'f1', extractedHtml: '<p>Fresh extraction</p>' });
  });

  it('shows the excerpt when extraction fails offline', async () => {
    extractArticle.mockResolvedValue(null);
    const { getDb } = await import('../src/db/open');
    const { openItemForReading } = await import('../src/articles/service');
    await (await getDb()).clear('itemBodies');

    const result = await openItemForReading('f1::old');

    expect(result).toEqual({ bodyHtml: 'Old excerpt', extracted: false, extractionFailed: true });
  });
});
