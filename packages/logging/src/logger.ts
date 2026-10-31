import { randomUUID } from 'node:crypto';
import { LogRecord, type LogRecord as LogRecordT, LOG_ALLOWED_FIELDS } from '@blackbox/contracts';
import { sanitizeString, sanitizeErrorCode } from './redact.js';

export type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
const LEVELS: Record<Level, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
export const MAX_RECORD_BYTES = 16 * 1024;

export interface Sink { write(record: LogRecordT, line: string): void; flush?(): Promise<void> }

export interface LoggerOptions {
  component: LogRecordT['component'];
  serviceVersion: string;
  instanceId?: string;
  sinks: Sink[];
  /** Returns the current minimum level for a (component, connection) pair; used for 15-minute debug windows. */
  levelProvider?: () => { base: Level; debugConnections: Set<string>; debugAll: boolean };
}

export type Fields = Partial<Omit<LogRecordT, 'schema_version' | 'record_id' | 'occurred_at' | 'observed_at' | 'level' | 'event_name' | 'message' | 'component' | 'service_version' | 'instance_id' | 'scope'>> & { scope?: 'installation' | 'workspace' };

export class Logger {
  private readonly opts: LoggerOptions;
  private readonly instanceId: string;
  readonly dropped = { count: 0 };
  constructor(opts: LoggerOptions) { this.opts = opts; this.instanceId = opts.instanceId ?? `${opts.component}-${randomUUID().slice(0, 8)}`; }

  child(bound: Fields): BoundLogger { return new BoundLogger(this, bound); }
  debug(event: string, message: string, f: Fields = {}) { this.emit('DEBUG', event, message, f); }
  info(event: string, message: string, f: Fields = {}) { this.emit('INFO', event, message, f); }
  warn(event: string, message: string, f: Fields = {}) { this.emit('WARN', event, message, f); }
  error(event: string, message: string, f: Fields = {}) { this.emit('ERROR', event, message, f); }

  enabled(level: Level, connectionId?: string | null): boolean {
    const lp = this.opts.levelProvider?.() ?? { base: 'INFO' as Level, debugConnections: new Set<string>(), debugAll: false };
    if (level !== 'DEBUG') return LEVELS[level] >= LEVELS[lp.base] || lp.base === 'DEBUG';
    return lp.debugAll || (!!connectionId && lp.debugConnections.has(connectionId));
  }

  emit(level: Level, event: string, message: string, f: Fields) {
    if (!this.enabled(level, f.connection_id ?? null)) return;
    const now = new Date().toISOString();
    let truncated = false;
    const record: Record<string, unknown> = {
      schema_version: 1, record_id: randomUUID(), occurred_at: now, observed_at: now, level,
      event_name: sanitizeString(event, 80).value, component: this.opts.component,
      service_version: this.opts.serviceVersion, instance_id: this.instanceId,
      scope: f.tenant_id ? 'workspace' : (f.scope ?? 'installation'),
    };
    const m = sanitizeString(message); record.message = m.value; truncated ||= m.truncated;
    for (const key of LOG_ALLOWED_FIELDS) {
      if (key in record) continue;
      const v = (f as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue;
      if (key === 'error_code' || key === 'action_code') { record[key] = sanitizeErrorCode(v); continue; }
      if (typeof v === 'string') { const s = sanitizeString(v, 200); record[key] = s.value; truncated ||= s.truncated; }
      else if (typeof v === 'number' || typeof v === 'boolean') record[key] = v;
    }
    if (truncated) record.truncated = true;
    const checked = LogRecord.safeParse(record);
    if (!checked.success) { this.dropped.count++; return; }
    let line = JSON.stringify(checked.data);
    if (Buffer.byteLength(line) > MAX_RECORD_BYTES) { checked.data.message = checked.data.message.slice(0, 200) + '…'; checked.data.truncated = true; line = JSON.stringify(checked.data); }
    for (const sink of this.opts.sinks) { try { sink.write(checked.data, line); } catch { this.dropped.count++; } }
  }
  async flush() { await Promise.all(this.opts.sinks.map((s) => s.flush?.())); }
}

export class BoundLogger {
  constructor(private readonly base: Logger, private readonly bound: Fields) {}
  child(more: Fields) { return new BoundLogger(this.base, { ...this.bound, ...more }); }
  debug(e: string, m: string, f: Fields = {}) { this.base.emit('DEBUG', e, m, { ...this.bound, ...f }); }
  info(e: string, m: string, f: Fields = {}) { this.base.emit('INFO', e, m, { ...this.bound, ...f }); }
  warn(e: string, m: string, f: Fields = {}) { this.base.emit('WARN', e, m, { ...this.bound, ...f }); }
  error(e: string, m: string, f: Fields = {}) { this.base.emit('ERROR', e, m, { ...this.bound, ...f }); }
}

/** Sink writing WARN+ to stderr (container log), bounded per record. */
export class StderrSink implements Sink {
  constructor(private readonly minLevel: Level = 'WARN') {}
  write(record: LogRecordT, line: string) { if (LEVELS[record.level] >= LEVELS[this.minLevel]) process.stderr.write(line + '\n'); }
}
