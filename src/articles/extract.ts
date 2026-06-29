import { Readability } from '@mozilla/readability';
import { fetchArticleHtml, fetchImageAsDataUri } from '../feeds/fetch';

export interface ExtractResult {
  /** Extracted HTML body (with images inlined as data: URIs). Empty if extraction failed. */
  html: string;
  /** Optional title from the extracted article, if different from the feed item. */
  title?: string;
}

/**
 * Fetch an article via `/article?url=`, run Readability on the returned
 * HTML, and inline every `<img>` as a `data:` URI fetched via `/img?url=`.
 * Returns null when extraction fails (paywall, bot-challenge, etc.) so the
 * reading view can gracefully degrade to the stored excerpt.
 *
 * Requires a DOM (uses DOMParser). Browser-only by design.
 */
export async function extractArticle(articleUrl: string): Promise<ExtractResult | null> {
  const html = await fetchArticleHtml(articleUrl);
  if (!html) return null;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }

  let article;
  try {
    article = new Readability(doc).parse();
  } catch {
    return null;
  }
  if (!article || !article.content || article.content.trim().length === 0) {
    return null;
  }

  const inlined = await inlineImages(article.content);
  return {
    html: inlined,
    title: article.title ?? undefined,
  };
}

/**
 * Inline every `<img>` in the given HTML fragment as a `data:` URI fetched
 * via `/img?url=`. Preserves the original URL as `data-original-src` so
 * that storage eviction can lazily re-inline later. Images that fail to
 * fetch are left in place with their original `src`.
 */
export async function inlineImages(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src');
      if (!src) return;
      let absolute: string;
      try {
        absolute = new URL(src, document.baseURI).toString();
      } catch {
        return;
      }
      img.setAttribute('data-original-src', absolute);
      // Skip already-inlined data: URIs.
      if (src.startsWith('data:')) return;
      const dataUri = await fetchImageAsDataUri(absolute);
      if (dataUri) img.setAttribute('src', dataUri);
    }),
  );
  return doc.body.innerHTML;
}

/**
 * Strip inlined images from an extracted-HTML string, keeping only the
 * alt text and the original `data-original-src` attribute. Used by the
 * storage-eviction tier: keep text content, prepare for lazy re-inline.
 */
export function stripImages(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  for (const img of imgs) {
    const original = img.getAttribute('data-original-src') ?? img.getAttribute('src');
    img.removeAttribute('src');
    if (original) img.setAttribute('data-original-src', original);
  }
  return doc.body.innerHTML;
}

/**
 * Lazily re-inline images for an item whose extractedHtml has been evicted
 * to text-only. Re-fetches `data-original-src` URLs via `/img?url=` and
 * re-inlines as `data:` URIs. Intended to be called as the user scrolls
 * near images in the reading view.
 */
export async function reinlineImages(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img[data-original-src]'));
  await Promise.all(
    imgs.map(async (img) => {
      const original = img.getAttribute('data-original-src');
      if (!original) return;
      if (img.getAttribute('src') && img.getAttribute('src')?.startsWith('data:')) return;
      const dataUri = await fetchImageAsDataUri(original);
      if (dataUri) img.setAttribute('src', dataUri);
    }),
  );
  return doc.body.innerHTML;
}