/** Import plan resolution: relative presets become fixed UTC intervals once, in the workspace timezone (IMPORT-01). */
export type Preset = 'last_30_days' | 'this_year' | 'last_12_months' | 'custom' | 'from_now';
export interface ResolvedPlan { preset: Preset; timezone: string; requested_from: string | null; initial_cutoff: string; include_open_items: boolean; include_related: boolean; include_opening_state: boolean; strict_from_now: boolean; explanation: { en: string; de: string } }

function partsIn(tz: string, d: Date): { y: number; m: number; day: number } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); const s = f.format(d); const [y, m, day] = s.split('-').map(Number);
  return { y: y!, m: m!, day: day! };
}
/** Local midnight of a civil date in `tz` as a UTC instant (DST-safe iterative offset search). */
export function localMidnightUtc(tz: string, y: number, m: number, day: number): Date {
  let guess = Date.UTC(y, m - 1, day, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const diff = local - Date.UTC(y, m - 1, day, 0, 0, 0);
    if (diff === 0) break; guess -= diff;
  }
  return new Date(guess);
}
export function resolvePlan(preset: Preset, timezone: string, now: Date, opts: { customStart?: string; includeOpenItems?: boolean; includeRelated?: boolean; includeOpeningState?: boolean } = {}): ResolvedPlan {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { throw new Error('invalid timezone'); }
  const cutoff = now.toISOString();
  let from: Date | null;
  const p = partsIn(timezone, now);
  switch (preset) {
    case 'last_30_days': from = new Date(now.getTime() - 30 * 24 * 3600_000); break;
    case 'this_year': from = localMidnightUtc(timezone, p.y, 1, 1); break;
    case 'last_12_months': { let y = p.y, m = p.m - 12; while (m <= 0) { m += 12; y--; } const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); from = localMidnightUtc(timezone, y, m, Math.min(p.day, lastDay)); break; }
    case 'custom': { if (!opts.customStart || !/^\d{4}-\d{2}-\d{2}$/.test(opts.customStart)) throw new Error('custom start date required (YYYY-MM-DD)'); const [y, m, d] = opts.customStart.split('-').map(Number); const dt = localMidnightUtc(timezone, y!, m!, d!); if (dt > now) throw new Error('start date may not be in the future'); if (Number.isNaN(dt.getTime())) throw new Error('invalid date'); from = dt; break; }
    case 'from_now': from = null; break;
  }
  const strict = preset === 'from_now' && !(opts.includeOpenItems ?? false) && !(opts.includeOpeningState ?? false);
  const open = preset === 'from_now' ? (opts.includeOpenItems ?? false) : (opts.includeOpenItems ?? true);
  const related = preset === 'from_now' ? (opts.includeRelated ?? open) : (opts.includeRelated ?? true);
  const opening = preset === 'from_now' ? (opts.includeOpeningState ?? false) : (opts.includeOpeningState ?? true);
  const fmt = (d: Date, loc: string) => new Intl.DateTimeFormat(loc, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(d);
  const en = from ? `Records from ${fmt(from, 'en-GB')} to ${fmt(now, 'en-GB')} (${timezone})${open ? ', plus accessible older open items and their related records' : ''}${opening ? ', with opening state' : ''}.` : `Only records observed from ${fmt(now, 'en-GB')} (${timezone}) onward${open ? ', plus older open items' : ''}${opening ? ', with opening state' : ''}.`;
  const de = from ? `Datensätze von ${fmt(from, 'de-DE')} bis ${fmt(now, 'de-DE')} (${timezone})${open ? ', zusätzlich erreichbare ältere offene Posten und zugehörige Datensätze' : ''}${opening ? ', mit Eröffnungsbestand' : ''}.` : `Nur ab ${fmt(now, 'de-DE')} (${timezone}) beobachtete Datensätze${open ? ', zusätzlich ältere offene Posten' : ''}${opening ? ', mit Eröffnungsbestand' : ''}.`;
  return { preset, timezone, requested_from: from ? from.toISOString() : null, initial_cutoff: cutoff, include_open_items: open, include_related: related, include_opening_state: opening, strict_from_now: strict, explanation: { en, de } };
}
