// Standalone log reader used by `./blackbox logs` and `./blackbox diagnostics export`: reads hour-segmented NDJSON
// files from the logs volume without API or database. Filters mirror the UI (AND across dimensions).
import { readdirSync, readFileSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; }; const has = (k) => args.includes(k);
const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR']; const minLevel = LEVELS.indexOf((opt('--level', 'INFO') || 'INFO').toUpperCase());
const since = opt('--since', '1h'); const m = /^(\d+)([mhd])$/.exec(since); if (!m) { console.error('bad --since'); process.exit(2); }
const ms = Number(m[1]) * { m: 60_000, h: 3600_000, d: 86400_000 }[m[2]]; const from = new Date(Date.now() - ms); const fromHour = from.toISOString().slice(0, 13);
const component = opt('--component'); const connection = opt('--connection'); const run = opt('--run'); const format = opt('--format', 'text'); const lines = Number(opt('--lines', '200')); const follow = has('--follow'); const exportMode = has('--export'); const version = opt('--version', 'unknown');
const DIR = '/logs';
const segments = () => { if (!existsSync(DIR)) return []; const out = []; for (const c of readdirSync(DIR)) { const d = join(DIR, c); try { if (!statSync(d).isDirectory()) continue; } catch { continue; } if (component && c !== component) continue; for (const f of readdirSync(d)) if (f.endsWith('.ndjson') && f.slice(0, 13) >= fromHour) out.push({ c, p: join(d, f), hour: f.slice(0, 13) }); } return out.sort((a, b) => a.hour.localeCompare(b.hour)); };
const match = (r) => LEVELS.indexOf(r.level) >= minLevel && r.occurred_at >= from.toISOString() && (!connection || r.connection_id === connection) && (!run || r.run_id === run);
const fmt = (r) => format === 'json' ? JSON.stringify(r) : `${r.occurred_at} ${r.level.padEnd(5)} ${r.component.padEnd(7)} ${r.event_name.padEnd(28)} ${r.message}${r.error_code ? ` [${r.error_code}]` : ''}${r.run_id ? ` run=${r.run_id}` : ''}`;
const parse = (text) => text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
if (exportMode) {
  const recs = segments().flatMap((s) => parse(readFileSync(s.p, 'utf8'))).filter((r) => LEVELS.indexOf(r.level) >= 2 && r.occurred_at >= from.toISOString());
  const counts = {}; for (const r of recs) { const k = `${r.level}:${r.component}:${r.error_code ?? r.event_name}`; counts[k] = (counts[k] ?? 0) + 1; }
  const salt = String(Date.now()); const pseud = (v) => v ? 'p_' + Buffer.from(salt + v).toString('base64url').slice(0, 10) : null;
  const bundle = { bundle_version: 1, source: 'host_cli', generated_at: new Date().toISOString(), range: { since: from.toISOString(), until: new Date().toISOString() }, versions: { app: version, reader: 'host' }, error_counts: counts, log_excerpts: recs.slice(-500).map((r) => ({ occurred_at: r.occurred_at, level: r.level, component: r.component, event_name: r.event_name, message: r.message, error_code: r.error_code ?? null, connection: pseud(r.connection_id), run: pseud(r.run_id) })), notice: 'Host CLI export: live health probes are unavailable without the API; identifiers pseudonymized; no business content.' };
  let json = JSON.stringify(bundle, null, 1); if (Buffer.byteLength(json) > 10 * 1024 * 1024) { bundle.log_excerpts = bundle.log_excerpts.slice(-100); bundle.truncated = true; json = JSON.stringify(bundle, null, 1); }
  process.stdout.write(json); process.exit(0);
}
const segs = segments(); if (!segs.length) { console.error(`no retained log segments since ${since}${component ? ` for ${component}` : ''} (retention: 7 days / 100 MiB)`); process.exit(2); }
const all = segs.flatMap((s) => parse(readFileSync(s.p, 'utf8'))).filter(match).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
for (const r of all.slice(-lines)) console.log(fmt(r));
if (!follow) process.exit(0);
const offsets = new Map(segs.map((s) => [s.p, statSync(s.p).size]));
setInterval(() => { for (const s of segments()) { let size; try { size = statSync(s.p).size; } catch { continue; } const prev = offsets.get(s.p) ?? 0; if (size > prev) { const buf = Buffer.alloc(size - prev); const fd = openSync(s.p, 'r'); readSync(fd, buf, 0, buf.length, prev); closeSync(fd); for (const r of parse(buf.toString('utf8'))) if (match(r)) console.log(fmt(r)); } offsets.set(s.p, size); } }, 1000);
