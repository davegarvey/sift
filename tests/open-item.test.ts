// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb } from '../src/db/open';
import { bulkUpsertItems, getItem, getItemBody } from '../src/db/items';
import type { ItemInput } from '../src/db/types';

const extractArticle = vi.hoisted(() => vi.fn());

vi.mock('../src/articles/extract', () => ({ extractArticle }));

const { openItemForReading } = await import('../src/articles/service');

function makeInput(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: 'f1::g1',
    feedId: 'f1',
    guid: 'g1',
    title: 'Title',
    excerpt: 'Excerpt text',
    link: 'https://example.com/post',
    publishedAt: 1000,
    updatedAt: 1000,
    read: false,
    starred: false,
    createdAt: 1000,
    ...overrides,
  };
}

beforeEach(async () => {
  extractArticle.mockReset();
  const db = await getDb();
  for (const store of ['items', 'itemBodies', 'itemFlags', 'feedStats', 'readMarkers'] as const) await db.clear(store);
});

describe('openItemForReading', () => {
  it('returns feed HTML from the body store without extracting', async () => {
    await bulkUpsertItems([makeInput({ html: '<p>Full feed content</p>' })]);

    const result = await openItemForReading('f1::g1');

    expect(result.bodyHtml).toContain('Full feed content');
    expect(result.extractionFailed).toBe(false);
    expect(extractArticle).not.toHaveBeenCalled();
    expect((await getItem('f1::g1'))?.firstOpenedAt).toEqual(expect.any(Number));
  });

  it('prefers feed HTML over a cached extraction', async () => {
    await bulkUpsertItems([makeInput({ html: '<p>Feed wins</p>' })]);
    await (await getDb()).put('itemBodies', { id: 'f1::g1', feedId: 'f1', html: '<p>Feed wins</p>', extractedHtml: '<p>Cached</p>' });

    const result = await openItemForReading('f1::g1');

    expect(result.bodyHtml).toContain('Feed wins');
    expect(result.bodyHtml).not.toContain('Cached');
  });

  it('uses the cached extraction when the feed HTML is partial content', async () => {
    const partial = '<p>Teaser</p><a href="https://example.com/post">Read more</a>';
    await bulkUpsertItems([makeInput({ html: partial })]);
    await (await getDb()).put('itemBodies', { id: 'f1::g1', feedId: 'f1', html: partial, extractedHtml: '<p>Cached full text</p>' });

    const result = await openItemForReading('f1::g1');

    expect(result.bodyHtml).toContain('Cached full text');
    expect(extractArticle).not.toHaveBeenCalled();
  });

  it('extracts when there is no body and stores the extraction in itemBodies', async () => {
    await bulkUpsertItems([makeInput()]);
    extractArticle.mockResolvedValue({ html: '<p>Extracted text</p>' });

    const result = await openItemForReading('f1::g1');

    expect(extractArticle).toHaveBeenCalledWith('https://example.com/post', undefined);
    expect(result).toMatchObject({ extracted: true, extractionFailed: false });
    expect(result.bodyHtml).toContain('Extracted text');
    expect(await getItemBody('f1::g1')).toEqual({ id: 'f1::g1', feedId: 'f1', extractedHtml: '<p>Extracted text</p>' });
    const record = (await getItem('f1::g1')) as unknown as Record<string, unknown>;
    expect('extractedHtml' in record).toBe(false);
  });

  it('does not extract again once an extraction is stored', async () => {
    await bulkUpsertItems([makeInput()]);
    extractArticle.mockResolvedValue({ html: '<p>Extracted text</p>' });
    await openItemForReading('f1::g1');
    extractArticle.mockClear();

    const result = await openItemForReading('f1::g1');

    expect(result.bodyHtml).toContain('Extracted text');
    expect(extractArticle).not.toHaveBeenCalled();
  });

  it('falls back to the excerpt and stores nothing when extraction fails', async () => {
    await bulkUpsertItems([makeInput()]);
    extractArticle.mockResolvedValue(null);

    const result = await openItemForReading('f1::g1');

    expect(result).toEqual({ bodyHtml: 'Excerpt text', extracted: false, extractionFailed: true });
    expect(await getItemBody('f1::g1')).toBeUndefined();
  });

  it('reports failure for an unknown article', async () => {
    expect(await openItemForReading('f1::missing')).toEqual({ bodyHtml: '', extracted: false, extractionFailed: true });
  });
});
