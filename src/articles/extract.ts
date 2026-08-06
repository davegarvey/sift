import { Readability } from '@mozilla/readability';
import { fetchArticleHtml } from '../feeds/fetch';

export interface ExtractResult {
  html: string;
  title?: string;
}

export interface ImageInfo {
  src: string | null;
  originalSrc: string | null;
}

/**
 * True when any image matches the hero URL: exact equality on
 * `data-original-src`, or (when that is absent) the `/img?url=` src stripped
 * of its prefix and decoded non-throwingly (decode failure = no match).
 */
export function heroMatch(imgs: ImageInfo[], heroUrl: string): boolean {
  return imgs.some((img) => {
    if (img.originalSrc === heroUrl) return true;
    if (img.originalSrc != null || img.src == null || !img.src.startsWith('/img?url=')) return false;
    try {
      return decodeURIComponent(img.src.slice('/img?url='.length)) === heroUrl;
    } catch {
      return false;
    }
  });
}

function dim(value: string | null): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * Ad-banner proportions: integer `width >= 300` AND `height <= 150`.
 * Missing, non-numeric, or unit-suffixed values are never banner images.
 */
export function isBannerImage(width: string | null, height: string | null): boolean {
  const w = dim(width);
  const h = dim(height);
  return w !== null && h !== null && w >= 300 && h <= 150;
}

/**
 * High-signal image heuristic for the in-page hero tier: inside
 * `main`/`article`, a `2x` srcset descriptor (token, not substring), or
 * width/height attributes both >= 200.
 */
export function isHighSignal(img: {
  inMainArticle: boolean;
  srcset: string | null;
  width: string | null;
  height: string | null;
}): boolean {
  if (img.inMainArticle) return true;
  if (img.srcset != null && /(?:^|\s)2x(?:\s|$)/.test(img.srcset)) return true;
  const w = dim(img.width);
  const h = dim(img.height);
  return w !== null && h !== null && w >= 200 && h >= 200;
}

export function heroFrom(url: string | undefined, base?: string): string | undefined {
  if (!url) return undefined;
  try {
    const absolute = new URL(url, base).toString();
    return /^https?:/.test(absolute) ? absolute : undefined;
  } catch {
    return undefined;
  }
}

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

  const ogUrl = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');

  // Scan for the in-page hero tier BEFORE Readability runs — this Readability
  // version mutates the document in place, so a post-parse scan sees a gutted
  // body.
  const inPageHero = findInPageHero(doc, articleUrl);

  if (!doc.querySelector('base')) {
    const baseEl = doc.createElement('base');
    baseEl.setAttribute('href', articleUrl);
    doc.head.insertBefore(baseEl, doc.head.firstChild);
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

  let content = rewriteImagesToProxy(article.content, articleUrl);
  const heroUrl = heroFrom(ogUrl ?? undefined, articleUrl) ?? heroFrom(thumbnailUrl) ?? inPageHero;
  if (heroUrl) {
    content = injectHeroImageProxy(content, heroUrl);
  }
  return { html: content, title: article.title ?? undefined };
}

function findInPageHero(doc: Document, articleUrl: string): string | undefined {
  const imgs = Array.from(doc.querySelectorAll('img'));
  for (const img of imgs) {
    const src = img.getAttribute('src');
    if (!src) continue;
    let absolute: string;
    try {
      absolute = new URL(src, articleUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(absolute)) continue;
    if (
      isHighSignal({
        inMainArticle: img.closest('main, article') != null,
        srcset: img.getAttribute('srcset'),
        width: img.getAttribute('width'),
        height: img.getAttribute('height'),
      })
    ) {
      return absolute;
    }
  }
  return undefined;
}

function rewriteImagesToProxy(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  for (const img of imgs) {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('/img?url=')) continue;
    try {
      const absolute = new URL(src, baseUrl).toString();
      img.setAttribute('src', `/img?url=${encodeURIComponent(absolute)}`);
      img.setAttribute('data-original-src', absolute);
    } catch {
      // leave invalid URLs as-is
    }
  }
  return doc.body.innerHTML;
}

/**
 * Three-step rescue decision:
 *  (a) an existing image matches the hero URL -> unmodified;
 *  (b) any non-banner image exists -> unmodified (containment gate — healthy
 *      extractions are never touched);
 *  (c) otherwise (zero images or only banner-proportioned ones) -> inject the
 *      hero as the first child of <body> and drop the banner images.
 */
export function injectHeroImageProxy(html: string, heroUrl: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  const imgInfos: ImageInfo[] = imgs.map((img) => ({
    src: img.getAttribute('src'),
    originalSrc: img.getAttribute('data-original-src'),
  }));
  if (heroMatch(imgInfos, heroUrl)) return html;
  const hasContentImage = imgs.some(
    (img) => !isBannerImage(img.getAttribute('width'), img.getAttribute('height')),
  );
  if (hasContentImage) return html;
  for (const img of imgs) {
    img.remove();
  }
  const hero = doc.createElement('img');
  hero.setAttribute('src', `/img?url=${encodeURIComponent(heroUrl)}`);
  hero.setAttribute('data-original-src', heroUrl);
  hero.setAttribute('style', 'max-width:100%;height:auto;display:block;margin:0 auto 1em');
  doc.body.insertBefore(hero, doc.body.firstChild);
  return doc.body.innerHTML;
}
