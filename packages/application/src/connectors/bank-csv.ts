import { createHash } from 'node:crypto';
import type { Observation } from '../ingest/service.js';

/** Versioned bank CSV profile: explicit column mapping, sign/currency/date interpretation and declared coverage interval. */
export interface BankCsvProfile { version: 1; delimiter: ',' | ';' | '\t'; columns: { booked_at: string; value_at?: string; amount: string; currency?: string; reference: string; counterparty?: string }; default_currency?: string; decimal_separator: '.' | ','; date_format: 'YYYY-MM-DD' | 'DD.MM.YYYY'; sign_convention: 'signed' | 'credit_debit_columns'; debit_column?: string; payout_reference_pattern?: string }
export interface BankRowPreview { row: number; booked_at: string | null; amount_minor: number | null; currency: string | null; reference: string; direction: 'credit' | 'debit' | null; payout_hint: string | null; errors: string[] }

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let cur: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]!;
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch; continue; }
    if (ch === '"') quoted = true; else if (ch === delimiter) { cur.push(field); field = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; cur.push(field); field = ''; if (cur.some((c) => c.trim() !== '')) rows.push(cur); cur = []; } else field += ch; }
  cur.push(field); if (cur.some((c) => c.trim() !== '')) rows.push(cur);
  return rows;
}
function parseDate(v: string, fmt: BankCsvProfile['date_format']): string | null {
  const s = v.trim(); let m: RegExpExecArray | null;
  if (fmt === 'YYYY-MM-DD' && (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`;
  if (fmt === 'DD.MM.YYYY' && (m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s))) return `${m[3]}-${m[2]}-${m[1]}T00:00:00Z`;
  return null;
}
function parseAmount(v: string, sep: '.' | ','): number | null {
  let s = v.trim().replace(/\s/g, ''); if (!s) return null;
  if (sep === ',') s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  if (!/^[-+]?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac = ''] = s.replace('+', '').split('.'); const neg = int!.startsWith('-');
  const minor = Math.abs(Number(int)) * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -minor : minor;
}

export function previewBankCsv(text: string, profile: BankCsvProfile, statementId: string, coverage: { from: string; to: string }): { rows: BankRowPreview[]; valid: number; invalid: number; coverage: typeof coverage; statement_id: string } {
  const rows = parseCsv(text, profile.delimiter); if (rows.length === 0) return { rows: [], valid: 0, invalid: 0, coverage, statement_id: statementId };
  const header = rows[0]!.map((h) => h.trim()); const idx = (name?: string) => (name ? header.indexOf(name) : -1);
  const ci = { booked: idx(profile.columns.booked_at), value: idx(profile.columns.value_at), amount: idx(profile.columns.amount), currency: idx(profile.columns.currency), reference: idx(profile.columns.reference), debit: idx(profile.debit_column) };
  const out: BankRowPreview[] = [];
  const pattern = profile.payout_reference_pattern ? new RegExp(profile.payout_reference_pattern) : /\b(OUT-[A-Za-z0-9-]+|po_[A-Za-z0-9]+|payout[ _-]?[A-Za-z0-9-]+)\b/i;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!; const errors: string[] = [];
    if (ci.booked < 0 || ci.amount < 0 || ci.reference < 0) { errors.push('profile columns not found in header'); out.push({ row: r, booked_at: null, amount_minor: null, currency: null, reference: '', direction: null, payout_hint: null, errors }); continue; }
    const booked = parseDate(row[ci.booked] ?? '', profile.date_format); if (!booked) errors.push('invalid booking date');
    let amount = parseAmount(row[ci.amount] ?? '', profile.decimal_separator);
    let direction: 'credit' | 'debit' | null = null;
    if (profile.sign_convention === 'credit_debit_columns') { const debit = ci.debit >= 0 ? parseAmount(row[ci.debit] ?? '', profile.decimal_separator) : null; if (amount && amount > 0) direction = 'credit'; else if (debit && debit > 0) { amount = debit; direction = 'debit'; } else errors.push('no credit or debit amount'); }
    else if (amount === null) errors.push('invalid amount'); else { direction = amount >= 0 ? 'credit' : 'debit'; amount = Math.abs(amount); }
    const currency = (ci.currency >= 0 ? row[ci.currency]?.trim() : profile.default_currency) ?? null; if (!currency || !/^[A-Z]{3}$/.test(currency)) errors.push('missing or invalid currency');
    const reference = (row[ci.reference] ?? '').trim().slice(0, 300); if (!reference) errors.push('missing reference');
    if (booked && (booked < coverage.from || booked > coverage.to + 'T23:59:59Z')) errors.push('outside declared statement coverage');
    const hint = pattern.exec(reference)?.[1] ?? null;
    out.push({ row: r, booked_at: booked, amount_minor: amount, currency, reference, direction, payout_hint: hint, errors });
  }
  return { rows: out, valid: out.filter((x) => x.errors.length === 0).length, invalid: out.filter((x) => x.errors.length > 0).length, coverage, statement_id: statementId };
}

/** Convert valid preview rows into observations. Row identity = statement id + row content hash (repeat import deduplicates). */
export function bankObservations(preview: ReturnType<typeof previewBankCsv>, accountId: string): Observation[] {
  const out: Observation[] = [];
  for (const r of preview.rows) {
    if (r.errors.length || !r.booked_at || r.amount_minor === null || !r.currency || !r.direction) continue;
    const id = createHash('sha256').update(`${preview.statement_id}|${r.booked_at}|${r.amount_minor}|${r.currency}|${r.reference}|${r.direction}`).digest('hex').slice(0, 24);
    const entryId = `${preview.statement_id}:${id}`;
    out.push({ event_type: r.direction === 'credit' ? 'bank.credit_booked' : 'bank.debit_booked', provider_event_id: entryId, occurred_at: r.booked_at, record_id: `bank_entry:${entryId}`,
      payload: { entry_id: entryId, statement_id: preview.statement_id, account_id: accountId, booked_at: r.booked_at, amount_minor: r.amount_minor, currency: r.currency, reference: r.reference, ...(r.direction === 'credit' && r.payout_hint ? { payout_id: r.payout_hint } : {}), booking_status: 'booked' } });
  }
  return out;
}
