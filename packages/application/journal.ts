import { z } from "zod";
import { createHmac } from "node:crypto";
import { scoped } from "../database/index.js";
import { equal, type Principal } from "../auth/index.js";
import { canonical } from "../auth/producer.js";

export const journalQuery = z
  .object({
    entity_id: z.uuid().optional(),
    connection_id: z.uuid().optional(),
    track: z
      .enum(["source", "fact", "commitment", "movement", "reservation"])
      .optional(),
    event_type: z
      .string()
      .regex(/^[a-z][a-z0-9_.]{0,79}$/)
      .optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    direction: z.enum(["asc", "desc"]).default("asc"),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: z.string().max(4000).optional(),
  })
  .strict();
export class InvalidCursor extends Error {}
export async function journal(input: unknown, p: Principal, secret: string) {
  const { cursor, ...q } = journalQuery.parse(input),
    fingerprint = canonical(q);
  return scoped(p.tenant_id, async (c) => {
    let cutoff = Number(
        (await c.query("SELECT committed FROM bb.heads")).rows[0].committed,
      ),
      after = q.direction === "asc" ? 0 : cutoff + 1;
    if (cursor) {
      const [data, mac] = cursor.split(".");
      if (
        !equal(
          createHmac("sha256", secret).update(data).digest("hex"),
          mac ?? "",
        )
      )
        throw new InvalidCursor();
      const saved = JSON.parse(Buffer.from(data, "base64url").toString());
      if (
        saved.tenant !== p.tenant_id ||
        saved.principal !== p.principal_id ||
        saved.fingerprint !== fingerprint
      )
        throw new InvalidCursor();
      cutoff = saved.cutoff;
      after = saved.after;
    }
    const rows = (
      await c.query(
        `SELECT * FROM bb.journal WHERE sequence ${q.direction === "asc" ? ">" : "<"} $1 AND sequence<=$2
      AND ($3::uuid IS NULL OR entity_id=$3) AND ($4::text IS NULL OR record_type=$4)
      AND ($5::uuid IS NULL OR connection_id=$5) AND ($6::text IS NULL OR event_type=$6)
      AND ($7::timestamptz IS NULL OR occurred_at>=$7) AND ($8::timestamptz IS NULL OR occurred_at<=$8)
      ORDER BY sequence ${q.direction === "asc" ? "ASC" : "DESC"} LIMIT $9`,
        [
          after,
          cutoff,
          q.entity_id ?? null,
          q.track ?? null,
          q.connection_id ?? null,
          q.event_type ?? null,
          q.from ?? null,
          q.to ?? null,
          q.limit + 1,
        ],
      )
    ).rows;
    const entries = rows.slice(0, q.limit),
      more = rows.length > q.limit;
    const data = Buffer.from(
      JSON.stringify({
        tenant: p.tenant_id,
        principal: p.principal_id,
        fingerprint,
        cutoff,
        after: Number(entries.at(-1)?.sequence ?? after),
      }),
    ).toString("base64url");
    return {
      entries,
      recorded_cutoff: cutoff,
      next_cursor: more
        ? `${data}.${createHmac("sha256", secret).update(data).digest("hex")}`
        : null,
      coverage: "observed_records_only",
    };
  });
}
