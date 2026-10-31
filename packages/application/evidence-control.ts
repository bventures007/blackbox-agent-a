/** Read-only, bounded host status. Only the installation's bound owner sees it. */
import { join } from "node:path";
import { z } from "zod";
import { protectedBytes } from "../auth/key-material.js";

const date = z.iso.datetime({ offset: true }).nullable();
const schema = z
  .object({
    schema_version: z.literal(1),
    owner_workspace_id: z.uuid(),
    observed_at: date,
    state: z.enum([
      "scheduled",
      "checking",
      "running",
      "failed",
      "clock_anomaly",
      "maintenance_required",
    ]),
    last_checked_at: date,
    last_attempt: date,
    last_completed: date,
    next_check_at: date,
    check_interval_seconds: z.literal(3600),
    orphan_interval_seconds: z.literal(86400),
    scheduler_heartbeat: date,
    copies: z
      .object({
        observed_at: date,
        state: z.enum(["not_configured", "available", "unavailable"]),
        generations: z
          .array(
            z
              .object({
                generation: z.string().regex(/^[a-f0-9]{32}$/),
                recoverable_cutoff: z.iso.datetime({ offset: true }),
              })
              .strict(),
          )
          .max(100),
        total: z.number().int().nonnegative().max(20000).nullable(),
        truncated: z.boolean(),
      })
      .strict(),
  })
  .strict();

export async function evidenceMaintenanceStatus(
  tenant: string,
  directory = process.env.HOST_CONTROL_STATUS_DIR,
) {
  const unavailable = {
    state: "unavailable",
    scheduler_alive: false,
    status_stale: true,
  };
  if (!directory) return unavailable;
  try {
    const { owner_workspace_id, ...value } = schema.parse(
      JSON.parse(
        (
          await protectedBytes(join(directory, "evidence-policy.json"), 32768)
        ).toString(),
      ),
    );
    if (tenant !== owner_workspace_id) return unavailable;
    const now = Date.now(),
      heartbeat = value.scheduler_heartbeat
        ? Date.parse(value.scheduler_heartbeat)
        : 0;
    const observed = value.observed_at ? Date.parse(value.observed_at) : 0;
    return {
      ...value,
      scheduler_alive: heartbeat <= now + 5000 && now - heartbeat < 45000,
      status_stale: observed > now + 5000 || now - observed > 45000,
    };
  } catch {
    return unavailable;
  }
}
