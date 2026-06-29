import { describe, it, expect } from 'vitest';
import { parseFeed } from '../src/feeds/parse';
import { findAlternateFeeds } from '../src/feeds/discover';

const RSS_SAMPLE = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com</link>
    <description>Just an example</description>
    <item>
      <title>First post</title>
      <link>https://example.com/1</link>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <guid>example-1</guid>
      <description>Body of first</description>
      <content:encoded><![CDATA[<p>full body</p>]]></content:encoded>
    </item>
    <item>
      <title>Second post</title>
      <link>https://example.com/2</link>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
      <guid>example-2</guid>
      <description>No full body here</description>
    </item>
  </channel>
</rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Example</title>
  <link href="https://example.org"/>
  <id>urn:uuid:1</id>
  <entry>
    <title>An entry</title>
    <id>tag:example.org,2024:1</id>
    <link href="https://example.org/1"/>
    <updated>2024-01-01T00:00:00Z</updated>
    <published>2024-01-01T00:00:00Z</published>
    <summary>A summary</summary>
  </entry>
</feed>`;

const MISSING_GUID_SAMPLE = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>No Guids</title>
    <item>
      <title>Without guid</title>
      <link>https://example.com/x</link>
      <pubDate>Wed, 03 Jan 2024 00:00:00 GMT</pubDate>
      <description>Body</description>
    </item>
  </channel>
</rss>`;

const MALFORMED_SAMPLE = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Broken</title>
`;

describe('parseFeed', () => {
  it('parses RSS 2.0 with content:encoded', () => {
    const parsed = parseFeed(RSS_SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('Example Feed');
    expect(parsed!.items).toHaveLength(2);
    expect(parsed!.items[0].guid).toBe('example-1');
    expect(parsed!.items[0].html).toContain('<p>full body</p>');
    expect(parsed!.items[1].html).toBeUndefined();
  });

  it('parses Atom 1.0', () => {
    const parsed = parseFeed(ATOM_SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('Atom Example');
    expect(parsed!.items).toHaveLength(1);
    expect(parsed!.items[0].guid).toBe('tag:example.org,2024:1');
    expect(parsed!.items[0].link).toBe('https://example.org/1');
  });

  it('synthesizes a stable guid from link+pubDate when guid is missing', () => {
    const parsed = parseFeed(MISSING_GUID_SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(1);
    expect(parsed!.items[0].guid).toBe(
      'https://example.com/x|Wed, 03 Jan 2024 00:00:00 GMT',
    );
    // Idempotency: re-parsing yields the same guid (stable for dedup).
    const reparsed = parseFeed(MISSING_GUID_SAMPLE);
    expect(reparsed!.items[0].guid).toBe(parsed!.items[0].guid);
  });

  it('returns null for malformed feed', () => {
    const parsed = parseFeed(MALFORMED_SAMPLE);
    expect(parsed).toBeNull();
  });
});

describe('findAlternateFeeds', () => {
  it('finds RSS and Atom alternates and resolves relative URLs', () => {
    const html = `<!doctype html>
<html><head>
  <link rel="alternate" type="application/rss+xml" href="/feed.xml" title="RSS"/>
  <link rel="alternate" type="application/atom+xml" href="https://blog.example.com/atom"/>
  <link rel="stylesheet" href="/style.css"/>
</head><body>hi</body></html>`;
    const found = findAlternateFeeds(html, 'https://example.com/');
    expect(found).toContain('https://example.com/feed.xml');
    expect(found).toContain('https://blog.example.com/atom');
  });
});