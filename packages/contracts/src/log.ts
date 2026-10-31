import { z } from 'zod';
export const LOG_SCHEMA_VERSION = 1;
export const LogLevel = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']);
export const LogComponent = z.enum(['wrapper', 'api', 'worker', 'engine', 'mcp', 'postgres', 'fixture']);
export const LogRecord = z.object({
  schema_version: z.literal(1), record_id: z.string(), occurred_at: z.string(), observed_at: z.string(),
  level: LogLevel, event_name: z.string().max(80), message: z.string().max(512), component: LogComponent,
  service_version: z.string().max(40), instance_id: z.string().max(80), scope: z.enum(['installation', 'workspace']),
  tenant_id: z.string().uuid().nullable().optional(), connection_id: z.string().nullable().optional(), capability_id: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(), operation_id: z.string().nullable().optional(), attempt: z.number().int().nullable().optional(),
  trace_id: z.string().nullable().optional(), span_id: z.string().nullable().optional(), parent_span_id: z.string().nullable().optional(),
  duration_ms: z.number().nullable().optional(), record_count: z.number().int().nullable().optional(), error_code: z.string().max(80).nullable().optional(),
  retryable: z.boolean().nullable().optional(), next_retry_at: z.string().nullable().optional(), action_code: z.string().max(80).nullable().optional(),
  journal_batch_id: z.string().nullable().optional(), committed_cursor: z.number().int().nullable().optional(), applied_cursor: z.number().int().nullable().optional(),
  truncated: z.boolean().optional(),
}).strict();
export type LogRecord = z.infer<typeof LogRecord>;
export const LOG_ALLOWED_FIELDS = Object.keys(LogRecord.shape);
