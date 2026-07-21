export interface ParsedSubscription {
  title: string;
  xmlUrl: string;
  htmlUrl?: string;
  /** Folder path from root to this feed's parent. */
  folderPath: string[];
}

const ATTR_RE = /(\w[\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseOpml(xml: string): ParsedSubscription[] {
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

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tag)) !== null) {
    const key = m[1].toLowerCase();
    const val = (m[2] ?? m[3] ?? '');
    attrs[key] = decodeXmlEntities(val);
  }
  return attrs;
}