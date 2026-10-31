import pino from "pino";
import { mkdir, appendFile, stat, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const messages: Record<string, string> = {
  "service.started": "Service started",
  "journal.batch_committed": "Journal batch committed",
  "engine.batch_applied": "Engine batch applied",
  "query.served": "Business query served",
  "worker.failed": "Worker operation failed",
  "access.denied": "Access denied",
  "source.fetched": "Provider page fetched",
  "source.scheduler_failed": "Source scheduling operation failed",
  "source.retry_scheduled": "Source retry scheduled",
  "engine.apply_failed": "Engine apply operation failed",
  "operation.failed": "Application operation failed",
  "review.decision_saved": "Owner review decision saved",
  "review.readiness_checked": "Review query readiness checked",
  "review.resolved": "Review resolved after query checks",
  "diagnostics.event_invalid": "Unknown diagnostic event rejected",
};
const component = process.env.COMPONENT ?? "api",
  instance = randomUUID();
const file = join(process.env.LOG_DIR ?? ".runtime/logs", `${component}.jsonl`);
const queue: string[] = [];
let draining = false;
export const diagnostics = { dropped: 0, degraded: false };
async function drain() {
  if (draining) return;
  draining = true;
  try {
    await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
    while (queue.length) {
      const s = await stat(file).catch(() => null);
      if (
        s &&
        (s.size > 8 * 1024 * 1024 || Date.now() - s.mtimeMs > 7 * 86400000)
      ) {
        await unlink(file + ".1").catch(() => {});
        await rename(file, file + ".1");
      }
      await appendFile(file, queue.shift()!, { mode: 0o600 });
    }
  } catch {
    diagnostics.dropped += queue.length;
    queue.length = 0;
    diagnostics.degraded = true;
  } finally {
    draining = false;
  }
}
const logger = pino(
  {
    base: undefined,
    timestamp: false,
    formatters: { level: (_label, number) => ({ severity_number: number }) },
  },
  {
    write(line: string) {
      if (queue.length >= 1024) {
        diagnostics.dropped++;
        diagnostics.degraded = true;
        return;
      }
      queue.push(line);
      void drain();
    },
  },
);
export function log(event: string, metadata: Record<string, unknown> = {}) {
  if (!Object.hasOwn(messages, event)) event = "diagnostics.event_invalid";
  const record: Record<string, unknown> = {
    schema_version: 1,
    record_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    observed_at: new Date().toISOString(),
    level: event.endsWith("failed") ? "ERROR" : "INFO",
    event_name: event,
    message: messages[event] ?? "Operation recorded",
    component,
    service_version: "0.1.0",
    instance_id: instance,
    scope: "installation",
  };
  for (const k of [
    "tenant_id",
    "connection_id",
    "run_id",
    "trace_id",
    "operation_id",
  ])
    if (
      typeof metadata[k] === "string" &&
      /^[a-f0-9-]{36}$/.test(metadata[k] as string)
    )
      record[k] = metadata[k];
  for (const k of [
    "record_count",
    "duration_ms",
    "committed_cursor",
    "applied_cursor",
  ])
    if (typeof metadata[k] === "number" && Number.isFinite(metadata[k]))
      record[k] = metadata[k];
  if (record.tenant_id) record.scope = "workspace";
  if (record.level === "ERROR") logger.error(record);
  else logger.info(record);
}
