export interface ParsedSubscription {
  title: string;
  xmlUrl: string;
  htmlUrl?: string;
  /** Folder path from root to this feed's parent. */
  folderPath: string[];
}

const ATTR_RE = /(\w[\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseOpml(xml: string): ParsedSubscription[] {
  const out: ParsedSubscription[] = [];
  const stack: string[] = [];

  const openRe = /<outline\b[^>]*\/?>/gi;
  const closeRe = /<\/outline>/ig;

  // Token scan: track opens/closes to maintain folder path.
  const tokens: { type: 'open' | 'close'; tag: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(xml)) !== null) {
    tokens.push({ type: 'open', tag: m[0] });
  }
  while ((m = closeRe.exec(xml)) !== null) {
    tokens.push({ type: 'close', tag: m[0] });
  }
  tokens.sort((a, b) => {
    const ai = xml.indexOf(a.tag, 0);
    const bi = xml.indexOf(b.tag, ai);
    return ai - bi;
  });

  // Re-sort naively doesn't work for repeated tags; use a different approach
  // by scanning sequentially through the source.
  return sequentialScan(xml);
}

function sequentialScan(xml: string): ParsedSubscription[] {
  const out: ParsedSubscription[] = [];
  const stack: string[] = [];

  let i = 0;
  while (i < xml.length) {
    if (xml.startsWith('<outline', i)) {
      // Find the end of this tag.
      const end = xml.indexOf('>', i);
      if (end === -1) break;
      const tag = xml.slice(i, end + 1);
      const selfClosing = tag.endsWith('/>');
      const attrs = parseAttrs(tag);

      const xmlUrl = attrs['xmlurl'];
      if (xmlUrl) {
        out.push({
          title: attrs['title'] ?? attrs['text'] ?? xmlUrl,
          xmlUrl,
          htmlUrl: attrs['htmlurl'],
          folderPath: [...stack],
        });
      } else if (!selfClosing) {
        const name = attrs['text'] ?? attrs['title'] ?? '';
        if (name) stack.push(name);
        // If selfClosing and no xmlUrl we treat as a folder-with-no-name;
        // just continue.
        i = end + 1;
        // Note: if the tag is selfClosing but had a folder name, we shouldn't
        // push to the stack. Handle below.
        if (selfClosing && stack.length > 0) {
          // Self-closing tag without xmlUrl is a folder marker; we treat it
          // as a no-op (we already pushed the name, undo).
          stack.pop();
        }
        continue;
      }
      i = end + 1;
    } else if (xml.startsWith('</outline>', i)) {
      if (stack.length > 0) stack.pop();
      i += '</outline>'.length;
    } else {
      i++;
    }
  }
  return out;
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tag)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? '';
    attrs[key] = val;
  }
  return attrs;
}