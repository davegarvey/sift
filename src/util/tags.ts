export function normalizeTag(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase();
}
