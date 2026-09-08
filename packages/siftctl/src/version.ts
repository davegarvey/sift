import { readFileSync } from 'node:fs';

interface PackageMetadata {
  version?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function packageVersion(): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as unknown;
  } catch {
    throw new Error('Unable to read the siftctl package version');
  }
  if (!isRecord(parsed)) throw new Error('Unable to read the siftctl package version');
  const metadata = parsed as PackageMetadata;
  if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
    throw new Error('Unable to read the siftctl package version');
  }
  return metadata.version;
}
