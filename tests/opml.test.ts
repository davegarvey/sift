import { describe, it, expect } from 'vitest';
import { serializeOpml } from '../src/opml/serialize';
import { parseOpml } from '../src/opml/parse';
import { buildMergePreview } from '../src/opml/merge';

import { listFeeds, upsertFeed } from '../src/db/feeds';
import { getDb } from '../src/db/open';
import 'fake-indexeddb/auto';

async function reset() {
  const db = await getDb();
  await db.clear('feeds');
  await db.clear('items');
  await db.clear('meta');
}

const fixtures = [
  {
    url: 'https://a.example.com/feed',
    title: 'Alpha',
    htmlUrl: 'https://a.example.com',
    folder: ['Tech'],
    learnedIntervalMs: 60 * 60 * 1000,
    lastFetched: null,
  },
  {
    url: 'https://b.example.com/rss',
    title: 'Beta',
    folder: ['Tech', 'Newsletters'],
    learnedIntervalMs: 60 * 60 * 1000,
    lastFetched: null,
  },
  {
    url: 'https://c.example.com/feed',
    title: 'Gamma',
    learnedIntervalMs: 60 * 60 * 1000,
    lastFetched: null,
  },
];

describe('OPML round-trip', () => {
  it('serializes feeds with folders into valid OPML 2.0', () => {
    const opml = serializeOpml(fixtures as never);
    expect(opml).toContain('<?xml version="1.0"');
    expect(opml).toContain('<opml version="2.0">');
    expect(opml).toContain('text="Tech"');
    expect(opml).toContain('text="Newsletters"');
    expect(opml).toContain('xmlUrl="https://a.example.com/feed"');
    expect(opml).toContain('xmlUrl="https://c.example.com/feed"');
  });

  it('round-trips: export → parse reproduces feeds + folder paths', () => {
    const opml = serializeOpml(fixtures as never);
    const parsed = parseOpml(opml);
    expect(parsed.length).toBe(3);
    const alpha = parsed.find((p) => p.xmlUrl === 'https://a.example.com/feed');
    const beta = parsed.find((p) => p.xmlUrl === 'https://b.example.com/rss');
    const gamma = parsed.find((p) => p.xmlUrl === 'https://c.example.com/feed');
    expect(alpha?.folderPath).toEqual(['Tech']);
    expect(beta?.folderPath).toEqual(['Tech', 'Newsletters']);
    expect(gamma?.folderPath).toEqual([]);
  });
});

describe('OPML merge', () => {
  it('skip feeds whose normalized URL matches an existing subscription', async () => {
    await reset();
    await upsertFeed({
      id: crypto.randomUUID(),
      url: 'https://a.example.com/feed?utm_source=opml',
      title: 'Alpha (already subscribed)',
      learnedIntervalMs: 60 * 60 * 1000,
      lastFetched: null,
    });

    const opml = serializeOpml(fixtures as never);
    const parsed = parseOpml(opml);
    const preview = await buildMergePreview(parsed);
    expect(preview.total).toBe(3);
    expect(new Set(preview.newSubscriptions.map((s) => s.xmlUrl))).toEqual(
      new Set(['https://b.example.com/rss', 'https://c.example.com/feed']),
    );
    expect(preview.skipped).toBe(1);
  });
});