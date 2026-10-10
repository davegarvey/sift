import { redactUrl } from './redact';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·',
  laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥', deg: '°', times: '×', rarr: '→', larr: '←',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head', 'svg', 'iframe', 'object', 'embed']);
const BLOCKS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption',
  'table', 'tr', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
]);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'col']);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|<!--[\s\S]*?-->/g;

function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeEntities(value);
}

interface ListFrame {
  ordered: boolean;
  index: number;
}

export function htmlToMarkdown(html: string): string {
  const out: string[] = [];
  const lists: ListFrame[] = [];
  const links: string[] = [];
  let skipDepth = 0;
  let skipTag = '';
  let preDepth = 0;
  let quoteDepth = 0;
  let lastIndex = 0;

  const emit = (text: string): void => {
    if (text) out.push(text);
  };
  const blockBreak = (): void => {
    const joined = out.length > 0 ? out[out.length - 1] : '';
    if (out.length === 0 || joined.endsWith('\n\n')) return;
    emit(joined.endsWith('\n') ? '\n' : '\n\n');
  };
  const lineStart = (): string => (quoteDepth > 0 ? '> '.repeat(quoteDepth) : '');
  const text = (raw: string): void => {
    if (skipDepth > 0 || raw === '') return;
    const decoded = decodeEntities(raw);
    if (preDepth > 0) {
      emit(decoded);
      return;
    }
    const collapsed = decoded.replace(/\s+/g, ' ');
    const previous = out.length > 0 ? out[out.length - 1] : '';
    const atLineStart = previous === '' || previous.endsWith('\n');
    emit(atLineStart ? lineStart() + collapsed.replace(/^ /, '') : collapsed);
  };

  for (const match of html.matchAll(TAG)) {
    text(html.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    if (match[2] === undefined) continue;
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3] ?? '';

    if (skipDepth > 0) {
      if (tag === skipTag && !VOID.has(tag)) skipDepth += closing ? -1 : 1;
      continue;
    }
    if (SKIPPED.has(tag) && !closing) {
      skipDepth = 1;
      skipTag = tag;
      continue;
    }

    if (closing) {
      switch (tag) {
        case 'pre':
          preDepth = Math.max(0, preDepth - 1);
          emit('\n```');
          blockBreak();
          break;
        case 'ul':
        case 'ol':
          lists.pop();
          if (lists.length === 0) blockBreak();
          else if (out.length > 0 && !out[out.length - 1].endsWith('\n')) emit('\n');
          break;
        case 'li':
          if (out.length > 0 && !out[out.length - 1].endsWith('\n')) emit('\n');
          break;
        case 'blockquote':
          quoteDepth = Math.max(0, quoteDepth - 1);
          blockBreak();
          break;
        case 'strong':
        case 'b':
          emit('**');
          break;
        case 'em':
        case 'i':
          emit('_');
          break;
        case 'code':
          if (preDepth === 0) emit('`');
          break;
        case 'td':
        case 'th':
          emit(' ');
          break;
        case 'a': {
          const href = links.pop();
          emit(href ? `](${href})` : '');
          break;
        }
        default:
          if (/^h[1-6]$/.test(tag) || BLOCKS.has(tag)) blockBreak();
      }
      continue;
    }

    switch (tag) {
      case 'br':
        emit(`\n${lineStart()}`);
        break;
      case 'hr':
        blockBreak();
        emit('---');
        blockBreak();
        break;
      case 'img': {
        const src = attribute(attrs, 'src');
        if (src) emit(`![${(attribute(attrs, 'alt') ?? '').replace(/[[\]]/g, '')}](${redactUrl(src)})`);
        break;
      }
      case 'a': {
        const href = attribute(attrs, 'href');
        if (href && !/^\s*(javascript|data):/i.test(href)) {
          links.push(redactUrl(href));
          emit('[');
        } else {
          links.push('');
        }
        break;
      }
      case 'strong':
      case 'b':
        emit('**');
        break;
      case 'em':
      case 'i':
        emit('_');
        break;
      case 'code':
        if (preDepth === 0) emit('`');
        break;
      case 'pre':
        blockBreak();
        emit('```\n');
        preDepth++;
        break;
      case 'blockquote':
        blockBreak();
        quoteDepth++;
        break;
      case 'ul':
      case 'ol':
        if (lists.length === 0) blockBreak();
        lists.push({ ordered: tag === 'ol', index: 0 });
        break;
      case 'li': {
        const frame = lists[lists.length - 1];
        const previous = out.length > 0 ? out[out.length - 1] : '';
        if (previous !== '' && !previous.endsWith('\n')) emit('\n');
        const marker = frame?.ordered ? `${++frame.index}. ` : '- ';
        emit(`${lineStart()}${'  '.repeat(Math.max(0, lists.length - 1))}${marker}`);
        break;
      }
      default:
        if (/^h[1-6]$/.test(tag)) {
          blockBreak();
          emit(`${lineStart()}${'#'.repeat(Number(tag[1]))} `);
        } else if (BLOCKS.has(tag) && tag !== 'tr') {
          blockBreak();
        } else if (tag === 'tr') {
          blockBreak();
        }
    }
  }
  text(html.slice(lastIndex));

  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
