export function normalizeTag(input: string): string | null {
  const tag = input.trim().replace(/\s+/g, ' ').toLowerCase();
  return tag === 'all' ? null : tag;
}
