import { describe, it, expect } from 'vitest';
import { sanitizeString } from './redact.js';
import { Logger } from './logger.js';
describe('redaction before emission', () => {
  it('masks keys, tokens, cookies, emails and query strings', () => {
    const s = sanitizeString('key bbx_owner_abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopq user a@b.de Authorization: Bearer abc.def-ghi url https://x/y?token=1');
    expect(s.value).not.toMatch(/bbx_owner_[a-z]/); expect(s.value).not.toContain('a@b.de'); expect(s.value).not.toContain('abc.def'); expect(s.value).not.toContain('token=1');
  });
  it('escapes control and angle characters and clips', () => {
    const s = sanitizeString('a\u001b[31m<b>' + 'x'.repeat(600));
    expect(s.value).not.toContain('\u001b'); expect(s.value).not.toContain('<b>'); expect(s.truncated).toBe(true);
  });
  it('drops non-allowlisted fields and nested objects', () => {
    const lines: string[] = [];
    const log = new Logger({ component: 'api', serviceVersion: 't', sinks: [{ write: (_r, l) => lines.push(l) }] });
    log.info('test.event', 'hello', { tenant_id: '11111111-1111-4111-8111-111111111111', run_id: 'r1', ...({ password: 'x', nested: { a: 1 } } as object) });
    const rec = JSON.parse(lines[0]!);
    expect(rec.password).toBeUndefined(); expect(rec.nested).toBeUndefined(); expect(rec.scope).toBe('workspace');
  });
});
