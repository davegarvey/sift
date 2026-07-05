import { Readability } from '@mozilla/readability';
import { fetchArticleHtml } from '../feeds/fetch';

export interface ExtractResult {
  html: string;
  title?: string;
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

  const content = rewriteImagesToProxy(article.content, articleUrl);
  return { html: content, title: article.title ?? undefined };
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