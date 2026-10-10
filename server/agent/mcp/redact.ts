const SENSITIVE_PARAM = /(token|key|secret|auth|pass|sig|session|code)/i;
const USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i;

function paramName(part: string): string {
  const raw = part.split('=', 1)[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function redactParams(params: string): string {
  return params
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq === -1 || !SENSITIVE_PARAM.test(paramName(part))) return part;
      return `${part.slice(0, eq)}=REDACTED`;
    })
    .join('&');
}

export function redactUrl(url: string): string {
  const hashAt = url.indexOf('#');
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt + 1);
  const queryAt = base.indexOf('?');
  const path = (queryAt === -1 ? base : base.slice(0, queryAt)).replace(USERINFO, '$1');
  let out = path;
  if (queryAt !== -1) out += `?${redactParams(base.slice(queryAt + 1))}`;
  if (hashAt !== -1) out += `#${hash.includes('=') ? redactParams(hash) : hash}`;
  return out;
}

export function redactNullable(url: string | null | undefined): string | null {
  return url ? redactUrl(url) : null;
}
