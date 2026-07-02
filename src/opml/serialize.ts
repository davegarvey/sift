import type { Feed } from '../db/types';

/**
 * Serialize feed subscriptions into a valid OPML 2.0 document. Feeds are
 * grouped by their `folder` field (array of folder names from root to leaf).
 */
export function serializeOpml(feeds: Feed[]): string {
  const root = buildTree(feeds);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<opml version="2.0">');
  lines.push('  <head>');
  lines.push('    <title>rss subscriptions</title>');
  lines.push('  </head>');
  lines.push('  <body>');
  emit(root, 2, lines);
  lines.push('  </body>');
  lines.push('</opml>');
  return lines.join('\n');
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  feeds: Feed[];
}

function makeNode(name: string): TreeNode {
  return { name, children: new Map(), feeds: [] };
}

function buildTree(feeds: Feed[]): TreeNode {
  const root = makeNode('');
  for (const f of feeds) {
    const path = f.folder ?? [];
    let node = root;
    for (const part of path) {
      if (!node.children.has(part)) {
        node.children.set(part, makeNode(part));
      }
      node = node.children.get(part)!;
    }
    node.feeds.push(f);
  }
  return root;
}

function feedOutline(f: Feed, indent: number): string {
  const attrs = [
    'type="rss"',
    `text="${escapeXml(f.title)}"`,
    `title="${escapeXml(f.title)}"`,
    `xmlUrl="${escapeXml(f.url)}"`,
    f.htmlUrl ? `htmlUrl="${escapeXml(f.htmlUrl)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${' '.repeat(indent)}<outline ${attrs} />`;
}

function emit(node: TreeNode, indent: number, lines: string[]) {
  for (const f of node.feeds) lines.push(feedOutline(f, indent));
  for (const child of node.children.values()) {
    lines.push(`${' '.repeat(indent)}<outline text="${escapeXml(child.name)}" title="${escapeXml(child.name)}">`);
    emit(child, indent + 2, lines);
    lines.push(`${' '.repeat(indent)}</outline>`);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, "&apos;");
}