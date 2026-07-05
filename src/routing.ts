export function hashId(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function itemUrl(item: { id: string; title?: string }): string {
  const h = hashId(item.id);
  const slug = item.title ? slugify(item.title) : '';
  return slug ? `/i/${h}/${slug}` : `/i/${h}`;
}

export function parseItemIdFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/i\/([a-z0-9]+)/);
  return match?.[1] ?? null;
}
