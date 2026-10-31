import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { LogRecord } from '@blackbox/contracts';
import type { Sink } from './logger.js';

export interface StoreOptions { dir: string; component: string; maxBufferRecords?: number; flushIntervalMs?: number }

/**
 * Bounded asynchronous file sink: hour-segmented NDJSON files per component under <dir>/<component>/.
 * The buffer is finite; on overflow DEBUG/INFO are dropped first and the loss is counted (never blocks business threads).
 */
export class FileStoreSink implements Sink {
  private buffer: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  readonly dropped = { debug_info: 0, warn_error: 0 };
  private readonly max: number;
  constructor(private readonly opts: StoreOptions) {
    this.max = opts.maxBufferRecords ?? 5000;
    mkdirSync(join(opts.dir, opts.component), { recursive: true });
    this.timer = setInterval(() => this.flushSync(), opts.flushIntervalMs ?? 500);
    this.timer.unref();
  }
  write(record: LogRecord, line: string) {
    if (this.buffer.length >= this.max) {
      if (record.level === 'DEBUG' || record.level === 'INFO') { this.dropped.debug_info++; return; }
      if (this.buffer.length >= this.max * 1.2) { this.dropped.warn_error++; return; }
    }
    this.buffer.push(line);
  }
  segmentPath(d = new Date()) { return join(this.opts.dir, this.opts.component, `${d.toISOString().slice(0, 13)}.ndjson`); }
  flushSync() {
    if (this.buffer.length === 0) return;
    const lines = this.buffer; this.buffer = [];
    try { appendFileSync(this.segmentPath(), lines.join('\n') + '\n'); } catch { this.dropped.warn_error += lines.length; }
  }
  async flush() { this.flushSync(); }
  close() { if (this.timer) clearInterval(this.timer); this.flushSync(); }
}

export interface RetentionPolicy { maxDays: number; maxTotalBytes: number }
export const DEFAULT_RETENTION: RetentionPolicy = { maxDays: 7, maxTotalBytes: 100 * 1024 * 1024 };

export interface Segment { component: string; path: string; hour: string; bytes: number }

export function listSegments(dir: string): Segment[] {
  if (!existsSync(dir)) return [];
  const out: Segment[] = [];
  for (const component of readdirSync(dir)) {
    const cdir = join(dir, component);
    let files: string[] = [];
    try { if (!statSync(cdir).isDirectory()) continue; files = readdirSync(cdir); } catch { continue; }
    for (const f of files) if (f.endsWith('.ndjson')) { const p = join(cdir, f); try { out.push({ component, path: p, hour: f.slice(0, 13), bytes: statSync(p).size }); } catch { /* removed concurrently */ } }
  }
  return out.sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : 0));
}

/** Enforce age and total-size bounds by deleting the oldest hour segments first. Returns what was removed. */
export function enforceRetention(dir: string, policy: RetentionPolicy, now = new Date()): { removed: Segment[]; totalBytes: number } {
  const segments = listSegments(dir);
  const cutoff = new Date(now.getTime() - policy.maxDays * 86400_000).toISOString().slice(0, 13);
  const removed: Segment[] = [];
  let total = segments.reduce((s, x) => s + x.bytes, 0);
  for (const seg of segments) {
    if (seg.hour < cutoff || total > policy.maxTotalBytes) {
      if (seg.hour === now.toISOString().slice(0, 13) && total <= policy.maxTotalBytes) continue;
      try { unlinkSync(seg.path); removed.push(seg); total -= seg.bytes; } catch { /* ignore */ }
    }
  }
  return { removed, totalBytes: total };
}

export interface LogQuery {
  since?: Date; until?: Date; levels?: Set<string>; components?: Set<string>; tenantId?: string | null;
  connectionIds?: Set<string>; runIds?: Set<string>; traceId?: string; text?: string; eventNames?: Set<string>;
  pageSize: number; beforeCursor?: string; // cursor = `${occurred_at}|${record_id}` of the oldest row already shown
  includeInstallation?: boolean;
}

export interface LogPage { records: LogRecord[]; nextCursor: string | null; scannedBytes: number; segmentsScanned: number }

function matches(r: LogRecord, q: LogQuery): boolean {
  if (q.levels && !q.levels.has(r.level)) return false;
  if (q.components && !q.components.has(r.component)) return false;
  if (q.tenantId !== undefined) {
    if (r.scope === 'workspace' && r.tenant_id !== q.tenantId) return false;
    if (r.scope === 'installation' && q.includeInstallation === false) return false;
  }
  if (q.connectionIds && !(r.connection_id && q.connectionIds.has(r.connection_id))) return false;
  if (q.runIds && !(r.run_id && q.runIds.has(r.run_id))) return false;
  if (q.traceId && r.trace_id !== q.traceId) return false;
  if (q.eventNames && !q.eventNames.has(r.event_name)) return false;
  if (q.since && r.occurred_at < q.since.toISOString()) return false;
  if (q.until && r.occurred_at > q.until.toISOString()) return false;
  if (q.text) { const t = q.text.toLowerCase(); if (!(r.message.toLowerCase().includes(t) || r.event_name.toLowerCase().includes(t) || (r.error_code ?? '').toLowerCase().includes(t))) return false; }
  return true;
}

/** Newest-first bounded query over hour segments; stops as soon as a page is full. Literal text search only. */
export function queryLogs(dir: string, q: LogQuery): LogPage {
  const sinceHour = q.since ? q.since.toISOString().slice(0, 13) : '0000';
  const untilHour = q.until ? q.until.toISOString().slice(0, 13) : '9999';
  let segments = listSegments(dir).filter((s) => s.hour >= sinceHour && s.hour <= untilHour && (!q.components || q.components.has(s.component)));
  // group newest hour first, all components of that hour together
  const hours = [...new Set(segments.map((s) => s.hour))].sort().reverse();
  const out: LogRecord[] = [];
  let scanned = 0, segs = 0;
  let cursorTs: string | null = null, cursorId: string | null = null;
  if (q.beforeCursor) { const i = q.beforeCursor.indexOf('|'); cursorTs = q.beforeCursor.slice(0, i); cursorId = q.beforeCursor.slice(i + 1); }
  for (const hour of hours) {
    if (cursorTs && hour > cursorTs.slice(0, 13)) continue;
    const rows: LogRecord[] = [];
    for (const seg of segments.filter((s) => s.hour === hour)) {
      segs++;
      let text = '';
      try { text = readFileSync(seg.path, 'utf8'); } catch { continue; }
      scanned += text.length;
      for (const line of text.split('\n')) {
        if (!line) continue;
        let rec: LogRecord;
        try { rec = JSON.parse(line) as LogRecord; } catch { continue; }
        if (cursorTs && (rec.occurred_at > cursorTs || (rec.occurred_at === cursorTs && rec.record_id >= cursorId!))) continue;
        if (matches(rec, q)) rows.push(rec);
      }
    }
    rows.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : a.record_id < b.record_id ? 1 : -1));
    for (const r of rows) { out.push(r); if (out.length >= q.pageSize + 1) break; }
    if (out.length >= q.pageSize + 1) break;
  }
  const hasMore = out.length > q.pageSize;
  const page = out.slice(0, q.pageSize);
  const last = page.at(-1);
  return { records: page, nextCursor: hasMore && last ? `${last.occurred_at}|${last.record_id}` : null, scannedBytes: scanned, segmentsScanned: segs };
}

export function storeUsage(dir: string): { totalBytes: number; oldestHour: string | null; newestHour: string | null; segments: number } {
  const s = listSegments(dir);
  return { totalBytes: s.reduce((a, b) => a + b.bytes, 0), oldestHour: s[0]?.hour ?? null, newestHour: s.at(-1)?.hour ?? null, segments: s.length };
}

/** Tail the last N bytes of a segment; used by the CLI follow mode. */
export function tailBytes(path: string, bytes: number): string {
  const size = statSync(path).size; const start = Math.max(0, size - bytes); const buf = Buffer.alloc(size - start);
  const fd = openSync(path, 'r'); try { readSync(fd, buf, 0, buf.length, start); } finally { closeSync(fd); }
  return buf.toString('utf8');
}
