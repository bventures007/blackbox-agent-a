import { verifyDatabaseContract } from "../packages/runtime/compatibility.js";
import pg from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
await verifyDatabaseContract(pool);
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(18741001)");
  let tenant = (
    await c.query(
      "SELECT tenant_id FROM bb.workspaces ORDER BY created_at LIMIT 1",
    )
  ).rows[0]?.tenant_id;
  const reset = process.argv[2] === "reset";
  if (tenant && !reset) {
    console.log("Already initialized. Access and business data preserved.");
    await c.query("ROLLBACK");
  } else {
    if (!process.stdout.isTTY)
      throw Error("Protected interactive terminal required for key issuance");
    const prior = tenant
      ? (
          await c.query(
            "SELECT principal_id FROM bb.credentials WHERE tenant_id=$1 AND purpose='owner' ORDER BY created_at DESC LIMIT 1",
            [tenant],
          )
        ).rows[0]?.principal_id
      : undefined;
    const principal = prior ?? randomUUID();
    if (!tenant) {
      tenant = randomUUID();
      await c.query("INSERT INTO bb.workspaces(tenant_id,name) VALUES($1,$2)", [
        tenant,
        "My workspace",
      ]);
      await c.query("INSERT INTO bb.heads(tenant_id) VALUES($1)", [tenant]);
    } else
      await c.query(
        "UPDATE bb.credentials SET revoked_at=now() WHERE tenant_id=$1",
        [tenant],
      );
    const key = "bb_owner_" + randomBytes(32).toString("base64url");
    await c.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name) VALUES($1,$2,$3,'owner',$4,'Owner')",
      [
        tenant,
        randomUUID(),
        principal,
        createHash("sha256").update(key).digest("hex"),
      ],
    );
    await c.query(
      "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action) VALUES($1,$2,$3,$4)",
      [
        tenant,
        randomUUID(),
        principal,
        reset ? "access.reset" : "owner.created",
      ],
    );
    await c.query("COMMIT");
    console.log(
      "Save this personal administrator key in your password manager. Do not share it with agents.",
    );
    console.log(
      "Speichere diesen persönlichen Administratorschlüssel im Passwortmanager. Nicht mit Agenten teilen.",
    );
    console.log(key);
  }
} finally {
  c.release();
  await pool.end();
}
