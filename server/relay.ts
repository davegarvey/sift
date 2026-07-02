import type { Feed } from '../src/db/types';

const KEEPALIVE_MS = 30_000;
const TIMEOUT_MS = 10_000;

type PendingQuery = {
  resolve: (value: void | PromiseLike<void>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Relay {
  private feeds = new Map<string, Feed>();
  private controller: ReadableStreamDefaultController | null = null;
  private pending = new Map<string, PendingQuery>();
  private nextId = 1;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  handleSse(controller: ReadableStreamDefaultController): void {
    this.controller = controller;
    this.keepaliveTimer = setInterval(() => this.sendKeepalive(), KEEPALIVE_MS);
  }

  handleDisconnect(): void {
    this.controller = null;
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Browser disconnected'));
    }
    this.pending.clear();
  }

  handleSync(feeds: Feed[]): void {
    this.feeds.clear();
    for (const f of feeds) this.feeds.set(f.url, f);
  }

  handleAck(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    p.resolve(undefined);
    this.pending.delete(id);
  }

  getFeeds(): Feed[] {
    return [...this.feeds.values()];
  }

  getFeed(url: string): Feed | undefined {
    return this.feeds.get(url);
  }

  async relayAddFeed(feed: Feed): Promise<void> {
    const id = this.genId();
    return this.relayEvent('add-feed', { id, feed }, id);
  }

  async relayRemoveFeed(url: string): Promise<void> {
    const id = this.genId();
    return this.relayEvent('remove-feed', { id, url }, id);
  }

  private relayEvent(event: string, data: Record<string, unknown>, id: string): Promise<void> {
    if (!this.controller) return Promise.reject(new Error('Browser not connected'));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Browser did not respond in time'));
      }, TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      this.controller!.enqueue(new TextEncoder().encode(msg));
    });
  }

  private sendKeepalive(): void {
    if (!this.controller) return;
    try {
      this.controller.enqueue(new TextEncoder().encode('event: keepalive\ndata: {}\n\n'));
    } catch {
      this.handleDisconnect();
    }
  }

  private genId(): string {
    return String(this.nextId++);
  }
}

export function sseResponse(relay: Relay): Response {
  let started = false;
  const stream = new ReadableStream({
    start(controller) {
      relay.handleSse(controller);
      started = true;
    },
    cancel() {
      if (started) relay.handleDisconnect();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
