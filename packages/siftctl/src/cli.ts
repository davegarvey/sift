#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { baseUrl, readToken, writeToken } from './config.js';
import { ApiError, capabilities, groupStatus, pull, push, redeemToken } from './api.js';
import { tokenFingerprint } from './fingerprint.js';
import { fetchFeedMetadata, fetchItems } from './items.js';

const USAGE = `siftctl — control your Sift subscriptions

Usage:
  siftctl pair <code>               Redeem an agent pairing code from Sift Settings
  siftctl status [--json]           Show API status, base URL, group code, and token fingerprint
  siftctl feeds [--json]            List subscribed feeds
  siftctl feed add <url> [--title TITLE] [--tags TAG,...] [--json]
                                   Subscribe to a feed
  siftctl feed edit <url> [--title TITLE] [--tags TAG,...] [--json]
                                   Update feed title or tags
  siftctl feed remove <url> --yes [--json]
                                   Unsubscribe from a feed
  siftctl items <url> [--limit N] [--json]
                                   Show recent items (default 20)
  siftctl mark read <itemId> [--json]
                                   Mark an item read
  siftctl help                      Show this help

Environment:
  SIFTCTL_TOKEN   Agent token (overrides the config file)
  SIFTCTL_URL     Sift base URL (default ${baseUrl()})
  SIFTCTL_HOME    Config directory (default ~/.config)

Exit codes: 0 success, 1 runtime/API error, 2 usage error.`;

class UsageError extends Error {}

function isFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

interface OptionValue {
  present: boolean;
  value: string;
}

function takeValue(args: string[], flag: string): OptionValue {
  const idx = args.indexOf(flag);
  if (idx === -1) return { present: false, value: '' };
  const value = args[idx + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} requires a value`);
  }
  args.splice(idx, 2);
  return { present: true, value };
}

function requireFeedUrl(raw: string | undefined, command: string): string {
  if (!raw) throw new UsageError(`${command} requires a URL`);
  const url = raw.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
  } catch {
    throw new UsageError(`${command} requires a valid http(s) URL`);
  }
  return url;
}

function normalizeTags(raw: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!tag) continue;
    if (tag === 'all') throw new UsageError('tag "all" is reserved');
    if (tag.length > 64) throw new UsageError('tags must be 64 characters or fewer');
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function requireToken(): string {
  const token = readToken();
  if (!token) {
    throw new Error('Not paired. Pair an agent from Sift Settings, then run: siftctl pair <code>');
  }
  return token;
}

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

interface FeedRow {
  feed_id: string;
  feed_url: string | null;
  html_url: string | null;
  title: string | null;
  folder: string | null;
  tags: string | null;
  deleted: number;
  row_at: number;
}

function liveRows(rows: FeedRow[]): FeedRow[] {
  return rows.filter((r) => r.deleted !== 1 && r.feed_url);
}

function findLiveFeed(rows: FeedRow[], url: string): FeedRow | undefined {
  return liveRows(rows).find((row) => row.feed_url === url);
}

async function cmdPair(code: string | undefined): Promise<void> {
  if (!code) throw new UsageError('pair requires a code: siftctl pair <code>');
  const token = await redeemToken(code.trim());
  writeToken(token);
  console.log(`Paired. Token fingerprint: ${await tokenFingerprint(token)}`);
}

async function cmdStatus(json: boolean): Promise<void> {
  const cap = await capabilities();
  const token = readToken();
  if (json) {
    out({
      sync: cap.sync,
      url: baseUrl(),
      paired: token !== null,
      groupFingerprint: token ? (await groupStatus(token)).groupFingerprint : null,
      fingerprint: token ? await tokenFingerprint(token) : null,
    });
    return;
  }
  console.log(`Sync: ${cap.sync ? 'available' : 'unavailable'}`);
  console.log(`URL: ${baseUrl()}`);
  if (token) {
    const group = (await groupStatus(token)).groupFingerprint;
    if (group) console.log(`Group: ${group}`);
    console.log(`Paired: yes (fingerprint ${await tokenFingerprint(token)})`);
  } else {
    console.log('Paired: no — run `siftctl pair <code>`');
  }
}

async function cmdFeeds(json: boolean): Promise<void> {
  const token = requireToken();
  const payload = await pull(token);
  const seen = new Set<string>();
  const feeds = liveRows(payload.feeds as unknown as FeedRow[])
    .filter((f) => {
      if (!f.feed_url || seen.has(f.feed_url)) return false;
      seen.add(f.feed_url);
      return true;
    });
  if (json) {
    out(feeds.map((f) => ({ feedId: f.feed_id, url: f.feed_url, htmlUrl: f.html_url ?? null, title: f.title, folder: parseJsonArray(f.folder), tags: parseJsonArray(f.tags) })));
    return;
  }
  for (const f of feeds) {
    console.log(`${f.title ?? '(untitled)'}\t${f.feed_url}`);
  }
}

function parseJsonArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveLiveFeed(token: string, url: string): Promise<FeedRow | undefined> {
  const payload = await pull(token);
  return findLiveFeed(payload.feeds as unknown as FeedRow[], url);
}

async function cmdFeedAdd(
  rawUrl: string | undefined,
  title: OptionValue,
  tags: OptionValue,
  json: boolean,
): Promise<void> {
  const url = requireFeedUrl(rawUrl, 'feed add');
  const explicitTags = tags.present ? normalizeTags(tags.value) : undefined;
  const token = requireToken();
  const [payload, discovered] = await Promise.all([
    pull(token),
    fetchFeedMetadata(url),
  ]);
  const existing = findLiveFeed(payload.feeds as unknown as FeedRow[], url);
  const feedId = existing?.feed_id ?? url;
  const feed: Record<string, unknown> = { feedId, feedUrl: url, deleted: 0 };
  const titleValue = title.present
    ? title.value
    : (existing && existing.title !== null && existing.title !== undefined ? undefined : discovered?.title);
  const htmlUrl = existing && existing.html_url !== null && existing.html_url !== undefined ? undefined : discovered?.htmlUrl;
  if (titleValue !== undefined) feed.title = titleValue;
  if (htmlUrl !== undefined) feed.htmlUrl = htmlUrl;
  if (explicitTags !== undefined) feed.tags = explicitTags;
  await push(token, { feeds: [feed] });
  if (json) {
    out({
      ok: true,
      operation: 'add',
      feedId,
      url,
      title: titleValue ?? existing?.title ?? null,
      htmlUrl: htmlUrl ?? existing?.html_url ?? null,
      tags: explicitTags ?? parseJsonArray(existing?.tags ?? null),
    });
  } else {
    console.log(`Subscribed: ${url}`);
  }
}

async function cmdFeedEdit(
  rawUrl: string | undefined,
  title: OptionValue,
  tags: OptionValue,
  json: boolean,
): Promise<void> {
  const url = requireFeedUrl(rawUrl, 'feed edit');
  if (!title.present && !tags.present) {
    throw new UsageError('feed edit requires --title or --tags');
  }
  const nextTags = tags.present ? normalizeTags(tags.value) : undefined;
  const token = requireToken();
  const existing = await resolveLiveFeed(token, url);
  if (!existing) throw new Error(`Not subscribed: ${url}`);
  const feed: Record<string, unknown> = { feedId: existing.feed_id };
  if (title.present) feed.title = title.value;
  if (nextTags !== undefined) feed.tags = nextTags;
  await push(token, { feeds: [feed] });
  if (json) {
    out({
      ok: true,
      operation: 'edit',
      feedId: existing.feed_id,
      url,
      title: title.present ? title.value : existing.title,
      tags: nextTags ?? parseJsonArray(existing.tags),
    });
  } else {
    console.log(`Updated: ${url}`);
  }
}

async function cmdFeedRemove(rawUrl: string | undefined, yes: boolean, json: boolean): Promise<void> {
  const url = requireFeedUrl(rawUrl, 'feed remove');
  if (!yes) throw new UsageError('feed remove is destructive — pass --yes to confirm: siftctl feed remove <url> --yes');
  const token = requireToken();
  const existing = await resolveLiveFeed(token, url);
  if (!existing) throw new Error(`Not subscribed: ${url}`);
  await push(token, { feeds: [{ feedId: existing.feed_id, feedUrl: url, deleted: 1 }] });
  if (json) {
    out({ ok: true, operation: 'remove', feedId: existing.feed_id, url });
  } else {
    console.log(`Unsubscribed: ${url}`);
  }
}

async function cmdItems(rawUrl: string | undefined, limit: number, json: boolean): Promise<void> {
  const url = requireFeedUrl(rawUrl, 'items');
  const token = readToken();
  let feedId = url;
  if (token) {
    const existing = await resolveLiveFeed(token, url);
    if (existing) feedId = existing.feed_id;
  }
  const items = await fetchItems(url, limit, feedId);
  if (json) {
    out(items);
    return;
  }
  for (const item of items) {
    console.log(`- ${item.title}`);
    if (item.link) console.log(`  ${item.link}`);
    console.log(`  id: ${item.itemId}`);
  }
}

async function cmdMarkRead(itemId: string | undefined, json: boolean): Promise<void> {
  if (!itemId) throw new UsageError('mark read requires an item id: siftctl mark read <itemId>');
  const lastSep = itemId.lastIndexOf('::');
  if (lastSep === -1) throw new UsageError('item id must contain "::" (feedId::guid)');
  let feedId: string;
  try {
    feedId = decodeURIComponent(itemId.slice(0, lastSep));
  } catch {
    throw new UsageError('item id has an invalid feed prefix');
  }
  const token = requireToken();
  await push(token, { flags: [{ itemId, feedId, read: 1 }] });
  if (json) {
    out({ ok: true, operation: 'mark-read', itemId, read: true });
  } else {
    console.log('Marked read.');
  }
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'pair':
      await cmdPair(rest[0]);
      return 0;
    case 'status':
      await cmdStatus(isFlag(rest, '--json'));
      return 0;
    case 'feeds': {
      const json = isFlag(rest, '--json');
      if (rest.length > 0) throw new UsageError('feeds takes no arguments');
      await cmdFeeds(json);
      return 0;
    }
    case 'feed': {
      const sub = rest.shift();
      if (sub === 'add') {
        const json = isFlag(rest, '--json');
        const title = takeValue(rest, '--title');
        const tags = takeValue(rest, '--tags');
        const url = rest.shift();
        if (rest.length > 0) throw new UsageError('feed add received unexpected arguments');
        await cmdFeedAdd(url, title, tags, json);
        return 0;
      }
      if (sub === 'edit') {
        const json = isFlag(rest, '--json');
        const title = takeValue(rest, '--title');
        const tags = takeValue(rest, '--tags');
        const url = rest.shift();
        if (rest.length > 0) throw new UsageError('feed edit received unexpected arguments');
        await cmdFeedEdit(url, title, tags, json);
        return 0;
      }
      if (sub === 'remove') {
        const yes = isFlag(rest, '--yes');
        const json = isFlag(rest, '--json');
        const url = rest.shift();
        if (rest.length > 0) throw new UsageError('feed remove received unexpected arguments');
        await cmdFeedRemove(url, yes, json);
        return 0;
      }
      throw new UsageError('feed requires a subcommand: add, edit, or remove');
    }
    case 'items': {
      const json = isFlag(rest, '--json');
      let limit = 20;
      const limitOption = takeValue(rest, '--limit');
      if (limitOption.present) {
        const raw = limitOption.value;
        limit = Number(raw);
        if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit must be a positive integer');
      }
      const url = rest.shift();
      if (rest.length > 0) throw new UsageError('items received unexpected arguments');
      await cmdItems(url, limit, json);
      return 0;
    }
    case 'mark': {
      const json = isFlag(rest, '--json');
      const action = rest.shift();
      const itemId = rest.shift();
      if (action !== 'read' || !itemId || rest.length > 0) throw new UsageError('mark requires: mark read <itemId>');
      await cmdMarkRead(itemId, json);
      return 0;
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(USAGE);
      return 0;
    default:
      throw new UsageError(`Unknown command: ${cmd}\n\n${USAGE}`);
  }
}

export async function runCli(argv: string[]): Promise<number> {
  try {
    return await main(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Usage: ${err.message}`);
      return 2;
    }
    if (err instanceof ApiError) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
