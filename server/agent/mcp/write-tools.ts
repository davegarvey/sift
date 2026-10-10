import { applyPush, type FlagPayload, type PushBody } from '../../sync/apply-push';
import { decodeItemId } from '../../../src/sync/itemId';
import { findFeeds, takeDiscoverBudget } from './discover';
import { loadLiveFeeds, normaliseTags, urlKey, type LiveFeed } from './data';
import { redactNullable, redactUrl } from './redact';
import type { Schema } from './schema';
import { ToolError, type ToolContext, type ToolDefinition } from './types';

const IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const TITLE_MAX = 200;
const MAX_ITEMS = 100;

const subscriptionSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['feedId', 'title', 'siteUrl', 'feedUrl', 'tags'],
  properties: {
    feedId: { type: 'string' },
    title: { type: 'string' },
    siteUrl: { type: ['string', 'null'] },
    feedUrl: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

function present(feed: LiveFeed) {
  return {
    feedId: feed.feedId,
    title: feed.title,
    siteUrl: redactNullable(feed.siteUrl),
    feedUrl: redactUrl(feed.url),
    tags: feed.tags,
  };
}

async function push(ctx: ToolContext, body: PushBody): Promise<void> {
  const result = await applyPush(ctx.db, ctx.pollDb, ctx.syncKey, body);
  if (result.ok) return;
  throw new ToolError(result.kind === 'cap' ? 'The account has reached its subscription or flag limit.' : result.message);
}

function cleanTitle(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  const title = (raw as string).trim();
  if (!title) throw new ToolError('title must not be empty.');
  if (title.length > TITLE_MAX) throw new ToolError(`title must be ${TITLE_MAX} characters or fewer.`);
  return title;
}

const tagsSchema: Schema = {
  type: 'array',
  items: { type: 'string', maxLength: 64 },
  maxItems: 20,
  description: 'Tags, lowercased and de-duplicated. "all" is reserved.',
};

const subscribe: ToolDefinition = {
  name: 'subscribe',
  title: 'Subscribe to a feed',
  description:
    'Subscribe to a feed. Accepts a feed URL or a page that advertises one, which is discovered first. Subscribing to a URL the user already follows returns the existing subscription unchanged. Devices see the new feed on their next sync.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', minLength: 1, maxLength: 2048, description: 'Feed URL, or a site or page URL.' },
      title: { type: 'string', description: 'Title to use instead of the feed\'s own.' },
      tags: tagsSchema,
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['created', 'subscription'],
    properties: { created: { type: 'boolean' }, subscription: subscriptionSchema },
  },
  async run(ctx, args) {
    const title = cleanTitle(args.title);
    const tags = Array.isArray(args.tags) ? normaliseTags(args.tags as string[]) : undefined;

    const existingFeeds = await loadLiveFeeds(ctx);
    const find = (url: string) => existingFeeds.find((feed) => urlKey(feed.url) === urlKey(url));
    const existing = find(args.url as string);
    if (existing) {
      return { data: { created: false, subscription: present(existing) }, text: `Already subscribed: ${existing.title} [${existing.feedId}]` };
    }

    await takeDiscoverBudget(ctx);
    const candidates = await findFeeds(ctx, args.url as string);
    if (candidates.length === 0) throw new ToolError('No feed found at that URL. Use discover_feeds to look for one.');
    const chosen = candidates.find((candidate) => !find(candidate.url)) ?? candidates[0];
    const known = find(chosen.url);
    if (known) {
      return { data: { created: false, subscription: present(known) }, text: `Already subscribed: ${known.title} [${known.feedId}]` };
    }

    await push(ctx, {
      feeds: [
        {
          feedId: crypto.randomUUID(),
          feedUrl: chosen.url,
          htmlUrl: chosen.siteUrl,
          title: title ?? chosen.title,
          ...(tags ? { tags } : {}),
          deleted: 0,
        },
      ],
    });
    const created = (await loadLiveFeeds(ctx)).find((feed) => urlKey(feed.url) === urlKey(chosen.url));
    if (!created) throw new ToolError('The subscription could not be confirmed. Try again.');
    return { data: { created: true, subscription: present(created) }, text: `Subscribed: ${created.title} [${created.feedId}]` };
  },
};

const updateSubscription: ToolDefinition = {
  name: 'update_subscription',
  title: 'Update a subscription',
  description: 'Change the title and/or tags of a subscription. Tags replace the existing set; pass an empty list to clear them.',
  scope: 'write',
  annotations: IDEMPOTENT,
  inputSchema: {
    type: 'object',
    required: ['feedId'],
    properties: {
      feedId: { type: 'string', minLength: 1 },
      title: { type: 'string' },
      tags: tagsSchema,
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['subscription'],
    properties: { subscription: subscriptionSchema },
  },
  async run(ctx, args) {
    const title = cleanTitle(args.title);
    const tags = Array.isArray(args.tags) ? normaliseTags(args.tags as string[]) : undefined;
    if (title === undefined && tags === undefined) throw new ToolError('Provide a title, tags, or both.');
    const feed = (await loadLiveFeeds(ctx)).find((candidate) => candidate.feedId === args.feedId);
    if (!feed) throw new ToolError('No subscription with that feedId.');

    const titleChanged = title !== undefined && title !== feed.title;
    const tagsChanged = tags !== undefined && (tags.length !== feed.tags.length || tags.some((tag, i) => tag !== feed.tags[i]));
    if (titleChanged || tagsChanged) {
      await push(ctx, {
        feeds: [{ feedId: feed.feedId, ...(titleChanged ? { title } : {}), ...(tagsChanged ? { tags } : {}) }],
      });
    }
    const updated = { ...feed, title: titleChanged ? (title as string) : feed.title, tags: tagsChanged ? (tags as string[]) : feed.tags };
    return { data: { subscription: present(updated) }, text: `Updated: ${updated.title} [${updated.feedId}]` };
  },
};

const unsubscribe: ToolDefinition = {
  name: 'unsubscribe',
  title: 'Unsubscribe from a feed',
  description:
    'Remove a subscription by feedId. Unsubscribing from a feed that is already gone succeeds with removed false. Reading history for the feed is kept on devices only until they sync.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    required: ['feedId'],
    properties: { feedId: { type: 'string', minLength: 1 } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['feedId', 'removed'],
    properties: { feedId: { type: 'string' }, removed: { type: 'boolean' } },
  },
  async run(ctx, args) {
    const feedId = args.feedId as string;
    const feed = (await loadLiveFeeds(ctx)).find((candidate) => candidate.feedId === feedId);
    if (!feed) return { data: { feedId, removed: false }, text: 'Not subscribed; nothing to remove.' };
    await push(ctx, { feeds: [{ feedId, deleted: 1 }] });
    return { data: { feedId, removed: true }, text: `Unsubscribed: ${feed.title}` };
  },
};

const setItemState: ToolDefinition = {
  name: 'set_item_state',
  title: 'Set item read or starred state',
  description: 'Mark up to 100 items read or unread and/or starred or unstarred. Item IDs come from list_items.',
  scope: 'write',
  annotations: IDEMPOTENT,
  inputSchema: {
    type: 'object',
    required: ['itemIds'],
    properties: {
      itemIds: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: MAX_ITEMS },
      read: { type: 'boolean', description: 'true marks read, false marks unread.' },
      starred: { type: 'boolean', description: 'true stars, false unstars.' },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['updated'],
    properties: { updated: { type: 'integer' } },
  },
  async run(ctx, args) {
    const read = typeof args.read === 'boolean' ? args.read : undefined;
    const starred = typeof args.starred === 'boolean' ? args.starred : undefined;
    if (read === undefined && starred === undefined) throw new ToolError('Provide read, starred, or both.');
    const feedIds = new Set((await loadLiveFeeds(ctx)).map((feed) => feed.feedId));
    const flags: FlagPayload[] = [];
    for (const itemId of new Set(args.itemIds as string[])) {
      const parsed = decodeItemId(itemId);
      if (!parsed || !feedIds.has(parsed.feedId)) throw new ToolError('One or more item IDs do not belong to a current subscription.');
      flags.push({
        itemId,
        feedId: parsed.feedId,
        ...(read !== undefined ? { read: read ? 1 : 0 } : {}),
        ...(starred !== undefined ? { starred: starred ? 1 : 0 } : {}),
      });
    }
    await push(ctx, { flags });
    return { data: { updated: flags.length }, text: `Updated ${flags.length} items.` };
  },
};

export const writeTools: ToolDefinition[] = [subscribe, updateSubscription, unsubscribe, setItemState];
