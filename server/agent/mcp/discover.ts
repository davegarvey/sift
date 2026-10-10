import { ARTICLE_MAX_BYTES, capBody, declaredLengthExceeds } from '../../body-cap';
import { fetchUpstreamWithPolicy } from '../../fetch';
import { assertNoUrlLog } from '../../log';
import { RATE_LIMITS, checkRateLimit } from '../../sync/ratelimit';
import { findAlternateFeeds } from '../../../src/feeds/discover';
import { parseFeed, type ParsedFeed } from '../../../src/feeds/parse';
import { isoDate, loadLiveFeeds, urlKey } from './data';
import { redactNullable, redactUrl } from './redact';
import { ToolError, type ToolContext, type ToolDefinition } from './types';

const CONVENTIONAL_PATHS = ['/feed', '/rss.xml', '/atom.xml', '/index.xml', '/feed.xml'];
const MAX_ALTERNATES = 5;

export interface RawCandidate {
  url: string;
  title: string;
  siteUrl: string | null;
  itemCount: number;
  newestDate: string | null;
  sampleTitles: string[];
}

export function parseInputUrl(raw: string): string {
  const trimmed = raw.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    return url.href;
  } catch {
    throw new ToolError('url must be a valid http or https URL.');
  }
}

export async function takeDiscoverBudget(ctx: ToolContext): Promise<void> {
  const limit = await checkRateLimit(
    ctx.db,
    `discover:${ctx.syncKey}`,
    RATE_LIMITS.discover.windowSeconds,
    RATE_LIMITS.discover.limit,
  );
  if (!limit.ok) {
    throw new ToolError(`Feed discovery rate limit reached. Retry in ${limit.retryAfter} seconds.`);
  }
}

async function fetchBody(ctx: ToolContext, url: string): Promise<{ ok: boolean; text: string } | null> {
  assertNoUrlLog(url);
  try {
    const res = await fetchUpstreamWithPolicy(
      url,
      { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' } },
      { db: ctx.db, route: 'discovery' },
    );
    if (res.status < 200 || res.status >= 300 || declaredLengthExceeds(res.headers, ARTICLE_MAX_BYTES)) {
      void res.body?.cancel().catch(() => undefined);
      return { ok: false, text: '' };
    }
    return { ok: true, text: await new Response(capBody(res.body, ARTICLE_MAX_BYTES)).text() };
  } catch {
    return null;
  }
}

function summarise(url: string, parsed: ParsedFeed): RawCandidate {
  const dates = parsed.items.map((item) => item.publishedAt).filter((value): value is number => value !== null);
  return {
    url,
    title: parsed.title,
    siteUrl: parsed.htmlUrl ?? null,
    itemCount: parsed.items.length,
    newestDate: dates.length > 0 ? isoDate(Math.max(...dates)) : null,
    sampleTitles: parsed.items.slice(0, 3).map((item) => item.title),
  };
}

async function tryFeed(ctx: ToolContext, url: string): Promise<RawCandidate | null> {
  const body = await fetchBody(ctx, url);
  if (!body?.ok) return null;
  const parsed = parseFeed(body.text, url);
  return parsed ? summarise(url, parsed) : null;
}

export async function findFeeds(ctx: ToolContext, input: string): Promise<RawCandidate[]> {
  const url = parseInputUrl(input);
  const tried = new Set([urlKey(url)]);
  const page = await fetchBody(ctx, url);
  if (!page) throw new ToolError('Could not fetch that URL.');

  if (page.ok) {
    const direct = parseFeed(page.text, url);
    if (direct) return [summarise(url, direct)];
  }

  const candidates: RawCandidate[] = [];
  if (page.ok) {
    for (const alternate of findAlternateFeeds(page.text, url)) {
      if (candidates.length >= MAX_ALTERNATES) break;
      if (!/^https?:/i.test(alternate) || tried.has(urlKey(alternate))) continue;
      tried.add(urlKey(alternate));
      const found = await tryFeed(ctx, alternate);
      if (found) candidates.push(found);
    }
  }
  if (candidates.length > 0) return candidates;

  const origin = new URL(url).origin;
  for (const path of CONVENTIONAL_PATHS) {
    const probe = `${origin}${path}`;
    if (tried.has(urlKey(probe))) continue;
    tried.add(urlKey(probe));
    const found = await tryFeed(ctx, probe);
    if (found) return [found];
  }
  return [];
}

const discoverFeeds: ToolDefinition = {
  name: 'discover_feeds',
  title: 'Discover feeds',
  description:
    'Find the RSS or Atom feeds for a website, page or feed URL, without subscribing. Fetches the URL, reads advertised feed links and probes common feed paths. Returns each candidate with its title, site URL, item count, newest item date, sample titles and whether the user already subscribes. Call this to verify any feed before recommending or subscribing to it.',
  scope: 'read',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string', minLength: 1, maxLength: 2048, description: 'A site, page or feed URL.' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['feedUrl', 'title', 'siteUrl', 'itemCount', 'newestDate', 'sampleTitles', 'alreadySubscribed'],
          properties: {
            feedUrl: { type: 'string' },
            title: { type: 'string' },
            siteUrl: { type: ['string', 'null'] },
            itemCount: { type: 'integer' },
            newestDate: { type: ['string', 'null'] },
            sampleTitles: { type: 'array', items: { type: 'string' }, maxItems: 3 },
            alreadySubscribed: { type: 'boolean' },
          },
        },
      },
    },
  },
  async run(ctx, args) {
    await takeDiscoverBudget(ctx);
    const [found, subscribed] = await Promise.all([findFeeds(ctx, args.url as string), loadLiveFeeds(ctx)]);
    const subscribedKeys = new Set(subscribed.map((feed) => urlKey(feed.url)));
    const candidates = found.map((candidate) => ({
      feedUrl: redactUrl(candidate.url),
      title: candidate.title,
      siteUrl: redactNullable(candidate.siteUrl),
      itemCount: candidate.itemCount,
      newestDate: candidate.newestDate,
      sampleTitles: candidate.sampleTitles,
      alreadySubscribed: subscribedKeys.has(urlKey(candidate.url)),
    }));
    if (candidates.length === 0) {
      return { data: { candidates }, text: 'No feed found at that URL.' };
    }
    const lines = candidates.map(
      (c) =>
        `- ${c.title} ${c.feedUrl}${c.alreadySubscribed ? ' (already subscribed)' : ''} | ${c.itemCount} items, newest ${c.newestDate ?? 'unknown'}${c.sampleTitles.length ? ` | e.g. ${c.sampleTitles.join('; ')}` : ''}`,
    );
    return { data: { candidates }, text: lines.join('\n') };
  },
};

export const discoverTools: ToolDefinition[] = [discoverFeeds];
