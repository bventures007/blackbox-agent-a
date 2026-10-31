/** Provider cursors are opaque potentially identifying data, never public progress. */
import { z } from "zod";
import { openSecret, sealSecret } from "../auth/secrets.js";
const fields = {
  from: z.iso.datetime({ offset: true }),
  through: z.iso.datetime({ offset: true }).optional(),
  stage: z.enum(["recent", "open"]),
  pages: z.number().int().nonnegative().max(10001),
  required_cursor: z.number().int().nonnegative().safe().optional(),
};
const cursor = z.string().min(1).max(4096).nullable();
const plain = z.object({ ...fields, after: cursor }).strict();
const stored = z
  .object({ ...fields, after: z.null(), sealed_after: z.unknown().optional() })
  .strict();
const purpose = (connection: string, job: string) =>
  `source-cursor-v1:${connection}:${job}`;
export async function sealCheckpoint(
  tenant: string,
  connection: string,
  job: string,
  value: unknown,
  target?: string,
) {
  const checkpoint = plain.parse(value);
  return {
    ...checkpoint,
    after: null,
    ...(checkpoint.after === null
      ? {}
      : {
          sealed_after: await sealSecret(
            tenant,
            purpose(connection, job),
            checkpoint.after,
            target,
          ),
        }),
  };
}
export async function openCheckpoint(
  tenant: string,
  connection: string,
  job: string,
  value: unknown,
) {
  const { sealed_after, ...checkpoint } = stored.parse(value);
  return {
    ...checkpoint,
    after:
      sealed_after === undefined
        ? null
        : cursor.parse(
            await openSecret(tenant, purpose(connection, job), sealed_after),
          ),
  };
}
