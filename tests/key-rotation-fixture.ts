/** Synthetic, host-maintenance-only rotation corpus. No provider network calls. */
import pg from "pg";
import assert from "node:assert/strict";
import {
  randomUUID,
  randomBytes,
  createHash,
  createCipheriv,
} from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  sealSecret,
  openSecret,
  opaqueIdentity,
} from "../packages/auth/secrets.js";
import {
  dataKey,
  encryptEvidence,
  decryptEvidence,
  durableReplace,
  protectedBytes,
  maxEvidenceCiphertext,
} from "../packages/auth/key-material.js";
const pool = new pg.Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
  max: 1,
});
const digest = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const mode = process.argv[2];
try {
  if (mode === "prepare") {
    const first = (
        await pool.query(
          "SELECT tenant_id FROM bb.workspaces ORDER BY created_at LIMIT 1",
        )
      ).rows[0].tenant_id,
      second = randomUUID();
    await pool.query(
      "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Synthetic key rotation second workspace')",
      [second],
    );
    await pool.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [second]);
    const proof = [];
    for (const tenant of [first, second]) {
      const connection = randomUUID(),
        plain = {
          account_id: "synthetic-rotation-account",
          token: "synthetic-" + randomBytes(32).toString("hex"),
        };
      let sealed = await sealSecret(tenant, connection, plain);
      if (tenant === first) {
        const key = await dataKey("data-v1"),
          nonce = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", key.bytes, nonce);
        cipher.setAAD(
          Buffer.from(`blackbox-secret-v1:${tenant}:${connection}`),
        );
        sealed = {
          version: 1 as any,
          key_version: "data-v1",
          nonce: nonce.toString("base64"),
          ciphertext: Buffer.concat([
            cipher.update(JSON.stringify(plain)),
            cipher.final(),
          ]).toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
        };
      }
      await pool.query(
        "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor,state,config)VALUES($1,$2,'shopify',$3,'paused','{\"rotation_test\":true}')",
        [tenant, connection, randomUUID()],
      );
      await pool.query(
        "INSERT INTO bb.source_secrets(tenant_id,connection_id,key_version,sealed,validated_at)VALUES($1,$2,$3,$4,now())",
        [tenant, connection, sealed.key_version, sealed],
      );
      await mkdir(join(process.env.EVIDENCE_DIR!, tenant), {
        recursive: true,
        mode: 0o700,
      });
      for (let n = 0; n < 128; n++) {
        const id = randomUUID(),
          bytes = Buffer.from(
            JSON.stringify({
              synthetic_rotation: true,
              sequence: n,
              padding: "x".repeat(128 * 1024),
            }),
          );
        let encrypted = await encryptEvidence(tenant, id, bytes);
        if (n === 0) {
          const key = await dataKey("data-v1"),
            nonce = randomBytes(12),
            cipher = createCipheriv("aes-256-gcm", key.bytes, nonce);
          cipher.setAAD(Buffer.from(`v1:${tenant}:${id}`));
          encrypted = Buffer.concat([
            nonce,
            cipher.update(bytes),
            cipher.final(),
            cipher.getAuthTag(),
          ]);
        }
        await durableReplace(
          join(process.env.EVIDENCE_DIR!, tenant, id),
          encrypted,
        );
        await pool.query(
          "INSERT INTO bb.evidence(tenant_id,evidence_id,sha256)VALUES($1,$2,$3)",
          [tenant, id, createHash("sha256").update(bytes).digest("hex")],
        );
      }
      proof.push({
        tenant,
        connection,
        plaintext_hash: digest(plain),
        stable_identity: await opaqueIdentity(
          tenant,
          "rotation-test-stable-identity",
        ),
      });
    }
    console.log(
      JSON.stringify({
        status: "prepared",
        proof,
        additional_evidence: 256,
        approximate_plaintext_bytes: 32 * 1024 * 1024,
      }),
    );
  } else if (mode === "verify") {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 16384) throw Error("test_input_oversized");
    }
    const proof = JSON.parse(input).proof;
    assert.equal(proof.length, 2);
    for (const row of proof) {
      const stored = (
        await pool.query(
          "SELECT key_version,sealed FROM bb.source_secrets WHERE tenant_id=$1 AND connection_id=$2",
          [row.tenant, row.connection],
        )
      ).rows[0];
      assert.equal(stored.key_version, (await dataKey()).id);
      assert.equal(
        digest(await openSecret(row.tenant, row.connection, stored.sealed)),
        row.plaintext_hash,
      );
      assert.equal(
        await opaqueIdentity(row.tenant, "rotation-test-stable-identity"),
        row.stable_identity,
      );
      await assert.rejects(() =>
        openSecret(randomUUID(), row.connection, stored.sealed),
      );
      await assert.rejects(() =>
        openSecret(row.tenant, randomUUID(), stored.sealed),
      );
      const evidence = (
        await pool.query(
          "SELECT evidence_id,sha256 FROM bb.evidence WHERE tenant_id=$1 ORDER BY evidence_id",
          [row.tenant],
        )
      ).rows;
      for (const e of evidence) {
        const bytes = await protectedBytes(
          join(process.env.EVIDENCE_DIR!, row.tenant, e.evidence_id),
          maxEvidenceCiphertext,
        );
        const plain = await decryptEvidence(row.tenant, e.evidence_id, bytes);
        assert.equal(
          createHash("sha256").update(plain).digest("hex"),
          e.sha256,
        );
      }
    }
    console.log(
      JSON.stringify({
        status: "passed",
        checks: [
          "both_tenant_credentials_and_identity_anchors_preserved",
          "credential_wrong_tenant_and_purpose_denied",
          "all_retained_evidence_plaintext_hashes_preserved",
        ],
      }),
    );
  } else throw Error("unsupported_fixture_mode");
} catch {
  console.error("synthetic_key_rotation_fixture_failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
