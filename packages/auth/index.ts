import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool, scoped } from "../database/index.js";
export const newKey = (purpose: string) =>
  `bb_${purpose}_${randomBytes(32).toString("base64url")}`;
export const verifier = (key: string) =>
  createHash("sha256").update(key).digest("hex");
export function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export type Principal = {
  tenant_id: string;
  credential_id: string;
  principal_id: string;
  purpose: "owner" | "agent" | "producer" | "session";
};
export async function authenticate(
  key: string,
  purposes: Principal["purpose"][],
): Promise<Principal> {
  if (key.length > 256) throw new Error("unauthorized");
  const { rows } = await pool.query<Principal>(
    "SELECT * FROM bb.authenticate($1)",
    [verifier(key)],
  );
  if (!rows[0] || !purposes.includes(rows[0].purpose))
    throw new Error("unauthorized");
  return rows[0];
}
export async function touch(p: Principal) {
  await scoped(p.tenant_id, (c) =>
    c.query(
      "UPDATE bb.credentials SET last_used_at=now() WHERE credential_id=$1",
      [p.credential_id],
    ),
  );
}
