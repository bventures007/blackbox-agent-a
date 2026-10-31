import { createReadStream, constants } from "node:fs";
import { readdir, stat, open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { z } from "zod";
import { createHmac } from "node:crypto";
import { equal } from "../auth/index.js";
import { canonical } from "../auth/producer.js";
export const events: Record<string, string> = {
  "service.started": "Service started",
  "journal.batch_committed": "Journal batch committed",
  "engine.batch_applied": "Engine batch applied",
  "query.served": "Business query served",
  "worker.failed": "Worker operation failed",
  "access.denied": "Access denied",
  "source.fetched": "Provider page fetched",
  "wrapper.command": "Host command started",
};
const rowSchema = z.object({
  schema_version: z.literal(1),
  record_id: z.uuid(),
  occurred_at: z.iso.datetime({ offset: true }),
  observed_at: z.iso.datetime({ offset: true }),
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  event_name: z.string(),
  component: z.enum(["api", "worker", "engine", "mcp", "wrapper"]),
  instance_id: z.uuid().optional(),
  tenant_id: z.uuid().optional(),
  connection_id: z.uuid().optional(),
  run_id: z.uuid().optional(),
  trace_id: z.uuid().optional(),
  operation_id: z.uuid().optional(),
  duration_ms: z.number().finite().optional(),
  record_count: z.number().finite().optional(),
  committed_cursor: z.number().finite().optional(),
  applied_cursor: z.number().finite().optional(),
});
export const logQuery = z
  .object({
    levels: z
      .array(z.enum(["DEBUG", "INFO", "WARN", "ERROR"]))
      .min(1)
      .max(4)
      .default(["INFO", "WARN", "ERROR"]),
    components: z
      .array(z.enum(["api", "worker", "engine", "mcp", "wrapper"]))
      .max(5)
      .default([]),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }).optional(),
    connection_id: z.uuid().optional(),
    run_id: z.uuid().optional(),
    trace_id: z.uuid().optional(),
    search: z.string().max(160).default(""),
    limit: z.number().int().min(1).max(1000).default(200),
    cursor: z.string().max(4000).optional(),
  })
  .strict();
export async function readLogs(
  input: unknown,
  tenant: string,
  principal: string,
  secret: string,
) {
  const { cursor, ...q } = logQuery.parse(input),
    fingerprint = canonical(q),
    directory = process.env.LOG_DIR!;
  let after = "",
    anchorFound = !cursor;
  if (cursor) {
    const [data, mac] = cursor.split(".");
    if (
      !equal(createHmac("sha256", secret).update(data).digest("hex"), mac ?? "")
    )
      throw Error("invalid_cursor");
    const saved = JSON.parse(Buffer.from(data, "base64url").toString());
    if (
      saved.tenant !== tenant ||
      saved.principal !== principal ||
      saved.fingerprint !== fingerprint
    )
      throw Error("invalid_cursor");
    after = saved.after;
  }
  const selected: Array<Record<string, unknown>> = [];
  let bytes = 0,
    skipped = 0,
    matched = 0,
    oldest: string | null = null,
    newest: string | null = null;
  const sortKey = (r: Record<string, unknown>) =>
    String(r.occurred_at) + "/" + r.record_id;
  for (const filename of (await readdir(directory))
    .filter((n) => /^(api|worker|engine|mcp|wrapper)\.jsonl(?:\.1)?$/.test(n))
    .sort()) {
    const path = join(directory, filename),
      s = await stat(path);
    bytes += s.size;
    // Only fixed collector files, no caller paths. A single component has a bounded 16-MiB ring.
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stream = handle.createReadStream();
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (line.length > 16384) {
          skipped++;
          continue;
        }
        let parsed: ReturnType<typeof rowSchema.safeParse>;
        try {
          parsed = rowSchema.safeParse(JSON.parse(line));
        } catch {
          skipped++;
          continue;
        }
        if (!parsed.success || !events[parsed.data.event_name]) {
          skipped++;
          continue;
        }
        const r = parsed.data;
        if (r.tenant_id && r.tenant_id !== tenant) continue;
        if (r.occurred_at < new Date(Date.now() - 7 * 86400000).toISOString())
          continue;
        oldest =
          oldest === null || r.occurred_at.localeCompare(String(oldest)) < 0
            ? r.occurred_at
            : oldest;
        newest =
          newest === null || r.occurred_at.localeCompare(String(newest)) > 0
            ? r.occurred_at
            : newest;
        const clean = {
            ...r,
            message: events[r.event_name],
            scope: r.tenant_id ? "workspace" : "installation",
            service_version: "0.1.0",
          },
          key = sortKey(clean);
        if (key === after) anchorFound = true;
        if (
          r.occurred_at < q.from ||
          (q.to && r.occurred_at > q.to) ||
          !q.levels.includes(r.level) ||
          (q.components.length && !q.components.includes(r.component))
        )
          continue;
        if (
          (q.connection_id && r.connection_id !== q.connection_id) ||
          (q.run_id && r.run_id !== q.run_id) ||
          (q.trace_id && r.trace_id !== q.trace_id)
        )
          continue;
        if (
          q.search &&
          !JSON.stringify(clean).toLowerCase().includes(q.search.toLowerCase())
        )
          continue;
        if (after && key >= after) continue;
        matched++;
        selected.push(clean);
        if (selected.length > q.limit + 100) {
          selected.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
          selected.length = q.limit + 1;
        }
      }
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  selected.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const records = selected.slice(0, q.limit),
    more = matched > q.limit;
  const data = Buffer.from(
    JSON.stringify({
      tenant,
      principal,
      fingerprint,
      after: records.length ? sortKey(records.at(-1)!) : after,
    }),
  ).toString("base64url");
  return {
    observed_at: new Date().toISOString(),
    records,
    next_cursor: more
      ? `${data}.${createHmac("sha256", secret).update(data).digest("hex")}`
      : null,
    cursor_status: anchorFound ? "retained" : "unavailable",
    retention: {
      oldest,
      newest,
      bytes,
      cap_bytes: 100 * 1024 * 1024,
      days: 7,
      skipped,
    },
    complete: false,
  };
}
