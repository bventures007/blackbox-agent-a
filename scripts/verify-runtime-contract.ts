import { readFile } from "node:fs/promises";
import pg from "pg";
import assert from "node:assert/strict";
import {
  runtimeFingerprint,
  verifyDatabaseContract,
} from "../packages/runtime/compatibility.js";
const checks: string[] = [];
for (const address of [
  process.env.DATABASE_URL,
  process.env.WORKER_DATABASE_URL,
  process.env.ENGINE_DATABASE_URL,
]) {
  assert.ok(address);
  const pool = new pg.Pool({ connectionString: address });
  try {
    await verifyDatabaseContract(pool);
    for (const query of [
      "UPDATE bb.runtime_contract SET state='fenced'",
      "DELETE FROM bb.schema_migrations",
    ]) {
      await assert.rejects(
        pool.query(query),
        (error: unknown) => (error as { code: string }).code === "42501",
      );
    }
  } finally {
    await pool.end();
  }
}
checks.push(
  "actual_API_worker_engine_roles_read_but_cannot_modify_global_contract_or_migration_metadata",
);
const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
let tenant: string;
try {
  tenant = (await admin.query("SELECT tenant_id FROM bb.workspaces LIMIT 1"))
    .rows[0].tenant_id;
} finally {
  await admin.end();
}
const internal = await readFile(process.env.INTERNAL_KEY_FILE!, "utf8");
for (const contract of [undefined, "0".repeat(64)]) {
  const response = await fetch(process.env.ENGINE_URL + "/v1/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-blackbox-internal": internal,
      ...(contract ? { "x-blackbox-contract": contract } : {}),
    },
    body: JSON.stringify({ tenant_id: tenant }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "runtime_contract_incompatible",
  });
}
checks.push(
  "actual_Rust_RPC_denies_missing_or_unknown_contract_even_with_valid_internal_authority",
);
assert.match(runtimeFingerprint, /^[a-f0-9]{64}$/);
process.stdout.write(JSON.stringify({ status: "passed", checks }));
