export const FEED_MAX_BYTES = 2 * 1024 * 1024;
export const ARTICLE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export function declaredLengthExceeds(headers: Headers, maxBytes: number): boolean {
  const raw = headers.get('Content-Length')?.trim();
  return raw !== undefined && /^\d+$/.test(raw) && Number(raw) > maxBytes;
}

export function capBody(body: ReadableStream<Uint8Array> | null, maxBytes: number): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  let seen = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(new Error('Upstream body exceeds the size limit'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}
