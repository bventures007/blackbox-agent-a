/** Narrow owner/host boundary. No destination, key, command, or arbitrary path input. */
import { constants } from "node:fs";
import { open, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Principal } from "../auth/index.js";

const date = z
  .string()
  .max(64)
  .refine((s) => Number.isFinite(Date.parse(s)))
  .nullable();
const statusSchema = z
  .object({
    schema_version: z.literal(1),
    owner_workspace_id: z.uuid().nullable(),
    observed_at: date,
    configured: z.boolean(),
    state: z.enum([
      "not_configured",
      "scheduled",
      "running",
      "failed",
      "overdue",
      "completed",
      "maintenance_required",
    ]),
    destination_available: z.boolean(),
    same_device: z.boolean(),
    last_attempt: date,
    last_completed: date,
    recoverable_cutoff: date,
    recoverable_age_seconds: z.number().int().nonnegative().nullable(),
    next_due_at: date,
    last_restore_test: date,
    bytes: z.number().int().nonnegative().nullable(),
    overdue: z.boolean(),
    clock_anomaly: z.boolean(),
    interval_seconds: z.number().int().min(1800).max(604800).nullable(),
    daily_retention: z.number().int().min(1).max(90).nullable(),
    weekly_retention: z.number().int().min(1).max(52).nullable(),
    retention_error: z.boolean(),
    request_pending: z.boolean(),
    maintenance_required: z.boolean(),
    scheduler_heartbeat: date,
  })
  .strict();

export async function backupStatus(
  directory = process.env.HOST_CONTROL_STATUS_DIR,
  tenant?: string,
) {
  if (!directory)
    return {
      state: "not_configured",
      configured: false,
      scheduler_alive: false,
    };
  try {
    const file = await open(
      join(directory, "backup.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let raw: string;
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        (process.getuid && info.uid !== process.getuid()) ||
        info.nlink !== 1 ||
        (info.mode & 0o077) !== 0 ||
        info.size > 32768
      )
        throw Error("unsafe_host_status");
      const bytes = Buffer.alloc(32769);
      const result = await file.read(bytes, 0, bytes.length, 0);
      if (result.bytesRead > 32768) throw Error("host_status_too_large");
      raw = bytes.subarray(0, result.bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
    const { owner_workspace_id, ...value } = statusSchema.parse(
      JSON.parse(raw),
    );
    if (tenant && owner_workspace_id !== tenant)
      throw Error("backup_workspace_denied");
    const now = Date.now(),
      heartbeat = value.scheduler_heartbeat
        ? Date.parse(value.scheduler_heartbeat)
        : 0;
    const cutoff = value.recoverable_cutoff
      ? Date.parse(value.recoverable_cutoff)
      : null;
    const overdue =
      value.configured && (cutoff === null || now - cutoff > 86400000);
    return {
      ...value,
      overdue,
      state:
        overdue &&
        !["running", "failed", "maintenance_required"].includes(value.state)
          ? "overdue"
          : value.state,
      recoverable_age_seconds:
        cutoff === null ? null : Math.max(0, Math.floor((now - cutoff) / 1000)),
      scheduler_alive: heartbeat <= now + 5000 && now - heartbeat < 45000,
      status_stale:
        !value.observed_at || now - Date.parse(value.observed_at) > 45000,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        state: "not_configured",
        configured: false,
        scheduler_alive: false,
      };
    return {
      state: "unknown",
      configured: false,
      scheduler_alive: false,
      status_stale: true,
    };
  }
}

const savingRequests = new Map<string, Promise<{ queued: boolean }>>();
export async function requestBackup(
  principal: Principal,
  directory = process.env.HOST_CONTROL_REQUEST_DIR,
) {
  if (!directory) throw Error("backup_not_configured");
  const scope = directory + ":" + principal.tenant_id;
  const pending = savingRequests.get(scope);
  if (pending) return pending;
  const saving = saveRequest(principal, directory);
  savingRequests.set(scope, saving);
  try {
    return await saving;
  } finally {
    savingRequests.delete(scope);
  }
}

async function saveRequest(principal: Principal, directory: string) {
  const temporary = join(directory, "backup.requesting"),
    destination = join(directory, "backup.json");
  let acquired = false;
  try {
    const file = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    acquired = true;
    try {
      await file.writeFile(
        JSON.stringify({
          schema_version: 1,
          request_id: randomUUID(),
          requested_at: new Date().toISOString(),
          principal_id: principal.principal_id,
          tenant_id: principal.tenant_id,
        }),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await link(temporary, destination);
    await unlink(temporary);
    acquired = false;
    const dir = await open(directory, constants.O_RDONLY);
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    return { queued: true };
  } catch (error) {
    if (acquired && (error as NodeJS.ErrnoException).code === "EEXIST") {
      // A prior completed request can be coalesced. A temporary writer file
      // alone is never evidence that an action was durably queued.
      const file = await open(
        destination,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await file.stat();
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          (info.mode & 0o077) !== 0 ||
          info.size > 2048
        )
          throw Error("backup_request_unavailable");
        const bytes = Buffer.alloc(2049),
          read = await file.read(bytes, 0, bytes.length, 0);
        if (read.bytesRead > 2048) throw Error("backup_request_unavailable");
        const previous = z
          .object({
            schema_version: z.literal(1),
            request_id: z.uuid(),
            requested_at: z.iso.datetime(),
            principal_id: z.uuid(),
            tenant_id: z.literal(principal.tenant_id),
          })
          .strict()
          .parse(JSON.parse(bytes.subarray(0, read.bytesRead).toString()));
        if (Date.now() - Date.parse(previous.requested_at) > 600000)
          throw Error("backup_request_unavailable");
      } finally {
        await file.close();
      }
      const dir = await open(directory, constants.O_RDONLY);
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
      return { queued: true };
    }
    throw Error("backup_request_unavailable");
  } finally {
    if (acquired) await unlink(temporary).catch(() => {});
  }
}
