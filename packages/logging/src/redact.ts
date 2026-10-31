/**
 * Allowlist + redaction applied BEFORE emission. Values are clipped, control characters escaped and
 * anything that looks like a credential, cookie, e-mail address, bearer token or URL query string is masked.
 */
const SECRET_PATTERNS: RegExp[] = [
  /bbx_(?:owner|agent|producer|recovery)_[a-z2-7]{20,}/gi,
  /(?:authorization|cookie|set-cookie|x-shopify-access-token|x-engine-token)\s*[:=]\s*[^\n,;]{1,400}/gi,
  /bearer\s+[a-z0-9._~+/=-]{8,}/gi,
  /shpat_[a-z0-9]{8,}/gi,
  /shpca_[a-z0-9]{8,}/gi,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  /\?[^\s"']{1,400}/g,
  /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;"']+/gi,
];
export const MAX_STRING = 512;

export function sanitizeString(value: string, max = MAX_STRING): { value: string; truncated: boolean } {
  let out = value;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  out = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u001b]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  out = out.replace(/</g, '‹').replace(/>/g, '›');
  const truncated = out.length > max;
  if (truncated) out = out.slice(0, max - 1) + '…';
  return { value: out, truncated };
}

export function sanitizeErrorCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : 'invalid_error_code';
}
