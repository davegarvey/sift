#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { baseUrl, readToken, writeToken } from './config.js';
import { ApiError, capabilities, pull, push, redeemToken } from './api.js';
import { tokenFingerprint } from './fingerprint.js';
import { fetchItems } from './items.js';

const USAGE = `siftctl — control your Sift subscriptions

Usage:
  siftctl pair <code>               Redeem an agent pairing code from Sift Settings
  siftctl status [--json]           Show API status, base URL, and token fingerprint
  siftctl feeds [--json]            List subscribed feeds
  siftctl feed add <url>            Subscribe to a feed
  siftctl feed remove <url> --yes   Unsubscribe from a feed
  siftctl items <url> [--limit N]   Show recent items from a feed (default 20)
  siftctl mark read <itemId>        Mark an item read
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
  title: string | null;
  folder: string | null;
  tags: string | null;
  deleted: number;
  row_at: number;
}

function liveRows(rows: FeedRow[]): FeedRow[] {
  return rows.filter((r) => r.deleted !== 1 && r.feed_url);
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
    out({ sync: cap.sync, url: baseUrl(), paired: token !== null, fingerprint: token ? await tokenFingerprint(token) : null });
    return;
  }
  console.log(`Sync: ${cap.sync ? 'available' : 'unavailable'}`);
  console.log(`URL: ${baseUrl()}`);
  if (token) {
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
    out(feeds.map((f) => ({ feedId: f.feed_id, url: f.feed_url, title: f.title, folder: parseJsonArray(f.folder), tags: parseJsonArray(f.tags) })));
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
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveFeedId(token: string, url: string): Promise<string> {
  const payload = await pull(token);
  const row = liveRows(payload.feeds as unknown as FeedRow[]).find((f) => f.feed_url === url);
  return row?.feed_id ?? url;
}

async function cmdFeedAdd(url: string | undefined): Promise<void> {
  if (!url) throw new UsageError('feed add requires a URL: siftctl feed add <url>');
  const token = requireToken();
  const feedId = await resolveFeedId(token, url);
  await push(token, { feeds: [{ feedId, feedUrl: url, deleted: 0 }] });
  console.log(`Subscribed: ${url}`);
}

async function cmdFeedRemove(url: string | undefined, yes: boolean): Promise<void> {
  if (!url) throw new UsageError('feed remove requires a URL: siftctl feed remove <url> --yes');
  if (!yes) throw new UsageError('feed remove is destructive — pass --yes to confirm: siftctl feed remove <url> --yes');
  const token = requireToken();
  const feedId = await resolveFeedId(token, url);
  await push(token, { feeds: [{ feedId, feedUrl: url, deleted: 1 }] });
  console.log(`Unsubscribed: ${url}`);
}

async function cmdItems(url: string | undefined, limit: number, json: boolean): Promise<void> {
  if (!url) throw new UsageError('items requires a URL: siftctl items <url>');
  const items = await fetchItems(url, limit);
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

async function cmdMarkRead(itemId: string | undefined): Promise<void> {
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
  console.log('Marked read.');
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
      const sub = rest[0];
      if (sub === 'add') {
        await cmdFeedAdd(rest[1]);
        return 0;
      }
      if (sub === 'remove') {
        const yes = isFlag(rest, '--yes');
        await cmdFeedRemove(rest[1], yes);
        return 0;
      }
      throw new UsageError('feed requires a subcommand: add or remove');
    }
    case 'items': {
      const json = isFlag(rest, '--json');
      let limit = 20;
      const limitIdx = rest.indexOf('--limit');
      if (limitIdx !== -1) {
        const raw = rest[limitIdx + 1];
        limit = Number(raw);
        if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit must be a positive integer');
        rest.splice(limitIdx, 2);
      }
      await cmdItems(rest[0], limit, json);
      return 0;
    }
    case 'mark':
      if (rest[0] !== 'read') throw new UsageError('mark requires: mark read <itemId>');
      await cmdMarkRead(rest[1]);
      return 0;
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
