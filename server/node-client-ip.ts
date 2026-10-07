import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { trustedProxyClientIp } from './proxy-guard';

function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

export function nodeClientIp(trustedProxyHops: number): (c: Context) => string | undefined {
  return trustedProxyClientIp(socketAddress, trustedProxyHops);
}
