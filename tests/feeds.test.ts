import { describe, it, expect } from 'vitest';
import { parseFeed, firstImgSrc } from '../src/feeds/parse';
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

const XKCD_ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>xkcd.com</title>
  <link href="https://xkcd.com/"/>
  <id>https://xkcd.com/</id>
  <entry>
    <title>Antiques Roadshow</title>
    <link href="https://xkcd.com/3281/" rel="alternate"/>
    <updated>2026-08-05T00:00:00Z</updated>
    <id>https://xkcd.com/3281/</id>
    <summary type="html">&lt;img src="https://imgs.xkcd.com/comics/antiques_roadshow.png" title="A long tooltip sentence for the comic." alt="A long alt sentence for the comic." /&gt;</summary>
  </entry>
</feed>`;

const SUMMARY_TEXT_AND_IMG_ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Blog</title>
  <link href="https://blog.example.com/"/>
  <id>https://blog.example.com/</id>
  <entry>
    <title>Post</title>
    <id>https://blog.example.com/1</id>
    <link href="https://blog.example.com/1"/>
    <updated>2024-01-01T00:00:00Z</updated>
    <summary type="html">&lt;p&gt;A teaser paragraph with words. &lt;img src="https://blog.example.com/hero.jpg"/&gt;&lt;/p&gt;</summary>
  </entry>
</feed>`;

const RELATIVE_SUMMARY_ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Rel</title>
  <link href="https://example.com/"/>
  <id>https://example.com/</id>
  <entry>
    <title>Post</title>
    <id>https://example.com/1</id>
    <link href="https://example.com/1"/>
    <updated>2024-01-01T00:00:00Z</updated>
    <summary type="html">&lt;img src="/images/hero.jpg"/&gt;</summary>
  </entry>
</feed>`;

const NESTED_SUMMARY_ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Nested</title>
  <link href="https://example.com/"/>
  <id>https://example.com/</id>
  <entry>
    <title>Post</title>
    <id>https://example.com/1</id>
    <link href="https://example.com/1"/>
    <updated>2024-01-01T00:00:00Z</updated>
    <summary type="html"><p>Hello <img src="https://example.com/x.jpg"/></p></summary>
  </entry>
</feed>`;

const MEDIA_THUMB_RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Media</title>
    <link>https://example.com</link>
    <item>
      <title>Post</title>
      <link>https://example.com/1</link>
      <guid>media-1</guid>
      <description>Body</description>
      <media:thumbnail url="https://example.com/thumb.jpg"/>
      <content:encoded><![CDATA[<p>full <img src="https://example.com/a.jpg"/></p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

const RSS_DESCRIPTION_IMG = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Desc</title>
    <link>https://example.com</link>
    <item>
      <title>Post</title>
      <link>https://example.com/1</link>
      <guid>desc-1</guid>
      <description>&lt;img src="https://example.com/hero.jpg"/&gt;</description>
    </item>
  </channel>
</rss>`;

const COMMENT_IMG_RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Comment</title>
    <link>https://example.com</link>
    <item>
      <title>Post</title>
      <link>https://example.com/1</link>
      <guid>comment-1</guid>
      <description>Body</description>
      <content:encoded><![CDATA[<!-- <img src="https://example.com/junk.png"/> --><p>text</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

const CONTENT_IMG_RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Content</title>
    <link>https://example.com</link>
    <item>
      <title>Post</title>
      <link>https://example.com/1</link>
      <guid>content-1</guid>
      <description>Body</description>
      <content:encoded><![CDATA[<p>full body <img src="https://example.com/a.jpg"/></p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

describe('feed image thumbnails', () => {
  it('captures the comic from an xkcd-style escaped image-only summary without setting html', () => {
    const parsed = parseFeed(XKCD_ATOM, 'https://xkcd.com/atom.xml');
    expect(parsed).not.toBeNull();
    const item = parsed!.items[0];
    expect(item.html).toBeUndefined();
    expect(item.thumbnail).toBe('https://imgs.xkcd.com/comics/antiques_roadshow.png');
    expect(item.excerpt).toBe('');
  });

  it('keeps text+image summaries unchanged (html unset) but still captures the image', () => {
    const parsed = parseFeed(SUMMARY_TEXT_AND_IMG_ATOM, 'https://blog.example.com/feed');
    expect(parsed).not.toBeNull();
    const item = parsed!.items[0];
    expect(item.html).toBeUndefined();
    expect(item.thumbnail).toBe('https://blog.example.com/hero.jpg');
    expect(item.excerpt.length).toBeGreaterThan(0);
  });

  it('absolutifies relative and protocol-relative image sources against the feed URL', () => {
    const parsed = parseFeed(RELATIVE_SUMMARY_ATOM, 'https://example.com/feed.xml');
    expect(parsed).not.toBeNull();
    expect(parsed!.items[0].thumbnail).toBe('https://example.com/images/hero.jpg');
  });

  it('yields no thumbnail from a nested-element summary (no #text shape)', () => {
    const parsed = parseFeed(NESTED_SUMMARY_ATOM, 'https://example.com/feed.xml');
    expect(parsed).not.toBeNull();
    expect(parsed!.items[0].thumbnail).toBeNull();
    expect(parsed!.items[0].html).toBeUndefined();
  });

  it('prefers media:thumbnail over the content image', () => {
    const parsed = parseFeed(MEDIA_THUMB_RSS, 'https://example.com/feed.xml');
    expect(parsed).not.toBeNull();
    expect(parsed!.items[0].thumbnail).toBe('https://example.com/thumb.jpg');
  });

  it('captures an image from content:encoded when no media thumbnail exists', () => {
    const parsed = parseFeed(CONTENT_IMG_RSS, 'https://example.com/feed.xml');
    expect(parsed).not.toBeNull();
    expect(parsed!.items[0].thumbnail).toBe('https://example.com/a.jpg');
    expect(parsed!.items[0].html).toContain('<img src="https://example.com/a.jpg"/>');
  });

  it('captures an image from an RSS description', () => {
    const parsed = parseFeed(RSS_DESCRIPTION_IMG, 'https://example.com/feed.xml');
    expect(parsed).not.toBeNull();
    expect(parsed!.items[0].thumbnail).toBe('https://example.com/hero.jpg');
  });

  it('ignores images inside HTML comments', () => {
    const parsed = parseFeed(COMMENT_IMG_RSS, 'https://example.com/feed.xml');
    expect(parsed).not.toBeNull();
    expect(parsed!.items[0].thumbnail).toBeNull();
  });
});

describe('firstImgSrc', () => {
  it('matches single-quoted src and rejects srcset-only images', () => {
    expect(firstImgSrc(`<img src='https://example.com/a.jpg'>`, 'https://example.com/feed')).toBe(
      'https://example.com/a.jpg',
    );
    expect(firstImgSrc(`<img srcset="a.png 1x, b.png 2x">`, 'https://example.com/feed')).toBeUndefined();
  });

  it('rejects non-http(s) schemes', () => {
    expect(firstImgSrc(`<img src="data:image/png;base64,AAAA">`, 'https://example.com/feed')).toBeUndefined();
  });
});