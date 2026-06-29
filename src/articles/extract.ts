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
export async function extractArticle(
  articleUrl: string,
  thumbnailUrl?: string,
): Promise<ExtractResult | null> {
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

  const inlined = await inlineImages(article.content, articleUrl);
  if (!thumbnailUrl) {
    return { html: inlined, title: article.title ?? undefined };
  }

  const heroInjected = await injectHeroImage(inlined, thumbnailUrl);
  return {
    html: heroInjected,
    title: article.title ?? undefined,
  };
}

/**
 * If the extracted HTML contains no `<img>` elements, inject the feed's
 * thumbnail (fetched via `/img?url=`) as a hero image at the top of the
 * content. Returns the original HTML unchanged when the thumbnail fetch
 * fails or the content already has images.
 */
export async function injectHeroImage(html: string, thumbnailUrl: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelector('img')) return html;
  const dataUri = await fetchImageAsDataUri(thumbnailUrl);
  if (!dataUri) return html;
  const hero = doc.createElement('img');
  hero.setAttribute('src', dataUri);
  hero.setAttribute('data-original-src', thumbnailUrl);
  hero.setAttribute('style', 'max-width:100%;height:auto;display:block;margin:0 auto 1em');
  doc.body.insertBefore(hero, doc.body.firstChild);
  return doc.body.innerHTML;
}

/**
 * Inline every `<img>` in the given HTML fragment as a `data:` URI fetched
 * via `/img?url=`. Preserves the original URL as `data-original-src` so
 * that storage eviction can lazily re-inline later. Fetched images replace
 * the original `src`; images that fail to fetch have their `src` removed.
 *
 * @param html - The HTML fragment to process.
 * @param articleUrl - Optional article URL used as base for resolving relative image URLs.
 */
export async function inlineImages(html: string, articleUrl?: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  const base = articleUrl ?? document.baseURI;
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src');
      if (!src) return;
      let absolute: string;
      try {
        absolute = new URL(src, base).toString();
      } catch {
        return;
      }
      img.setAttribute('data-original-src', absolute);
      if (src.startsWith('data:')) return;
      const dataUri = await fetchImageAsDataUri(absolute);
      if (dataUri) {
        img.setAttribute('src', dataUri);
      } else {
        img.removeAttribute('src');
      }
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