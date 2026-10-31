import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  chmod,
  unlink,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, randomBytes, createHash } from "node:crypto";
import {
  dataKey,
  encryptEvidence,
  decryptEvidence,
  evidenceKeyId,
  durableReplace,
  identityKey,
} from "../packages/auth/key-material.js";
import {
  sealSecret,
  openSecret,
  opaqueIdentity,
} from "../packages/auth/secrets.js";

test("versioned material preserves legacy decryption and identity, rejects tamper, then retires only the old data key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blackbox-key-boundary-")),
    previous = {
      data: process.env.DATA_KEY_FILE,
      identity: process.env.IDENTITY_KEY_FILE,
      layout: process.env.DATA_KEY_LAYOUT,
    };
  process.env.DATA_KEY_FILE = join(directory, "data");
  delete process.env.IDENTITY_KEY_FILE;
  delete process.env.DATA_KEY_LAYOUT;
  const tenant = "83aad8e4-a84f-4eb4-b901-7e86bf069a30",
    evidence = "c0d2f717-c4cb-4c9f-9701-573e4fae9505",
    old = randomBytes(32),
    plain = Buffer.from('{"synthetic":true}');
  const write = (name: string, data: Buffer | string) =>
    writeFile(join(directory, name), data, { mode: 0o600 });
  try {
    await write("data", old);
    process.env.DATA_KEY_LAYOUT = "keyring-v2";
    await assert.rejects(() => identityKey(), /metadata_missing/);
    await assert.rejects(
      () => encryptEvidence(tenant, evidence, plain),
      /metadata_missing/,
    );
    delete process.env.DATA_KEY_LAYOUT;
    const oldIdentity = await opaqueIdentity(tenant, "stable-fixture");
    assert.deepEqual(await identityKey(), old);
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", old, nonce);
    cipher.setAAD(Buffer.from(`v1:${tenant}:${evidence}`));
    const legacy = Buffer.concat([
      nonce,
      cipher.update(plain),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    assert.deepEqual(await decryptEvidence(tenant, evidence, legacy), plain);
    const secretNonce = randomBytes(12),
      secretCipher = createCipheriv("aes-256-gcm", old, secretNonce);
    secretCipher.setAAD(Buffer.from(`blackbox-secret-v1:${tenant}:credential`));
    const legacySecret = {
      version: 1,
      key_version: "data-v1",
      nonce: secretNonce.toString("base64"),
      ciphertext: Buffer.concat([
        secretCipher.update(plain),
        secretCipher.final(),
      ]).toString("base64"),
      tag: secretCipher.getAuthTag().toString("base64"),
    };
    assert.deepEqual(await openSecret(tenant, "credential", legacySecret), {
      synthetic: true,
    });
    await assert.rejects(() => openSecret(tenant, "different", legacySecret));
    await write("identity", randomBytes(32));
    await assert.rejects(
      () => opaqueIdentity(tenant, "stable-fixture"),
      /metadata_missing/,
    );
    const ring = {
      version: 2,
      active: "data-v1",
      keys: ["data-v1"],
      identity: "independent-v1",
      checksums: {
        "data-v1": createHash("sha256").update(old).digest("hex"),
      } as Record<string, string>,
      identity_sha256: createHash("sha256")
        .update(await readFile(join(directory, "identity")))
        .digest("hex"),
    };
    await write("keyring.json", JSON.stringify(ring));
    await write("data", randomBytes(32));
    await assert.rejects(
      () => encryptEvidence(tenant, evidence, plain),
      /integrity_mismatch/,
    );
    await write("data", old);
    const originalIdentity = await readFile(join(directory, "identity"));
    await write("identity", randomBytes(32));
    await assert.rejects(
      () => opaqueIdentity(tenant, "stable-fixture"),
      /integrity_mismatch/,
    );
    await write("identity", originalIdentity);
    const independentIdentity = await opaqueIdentity(tenant, "stable-fixture");
    assert.notEqual(independentIdentity, oldIdentity);
    const encrypted = await encryptEvidence(tenant, evidence, plain),
      secret = await sealSecret(tenant, "credential", { synthetic: true });
    assert.equal(evidenceKeyId(encrypted), "data-v1");
    assert.deepEqual(await decryptEvidence(tenant, evidence, encrypted), plain);
    assert.deepEqual(await openSecret(tenant, "credential", secret), {
      synthetic: true,
    });
    for (const offset of [encrypted.length - 1, encrypted.length - 20]) {
      const mutate = Buffer.from(encrypted);
      mutate[offset] ^= 1;
      await assert.rejects(() => decryptEvidence(tenant, evidence, mutate));
    }
    await assert.rejects(() =>
      decryptEvidence("different", evidence, encrypted),
    );
    await assert.rejects(() => decryptEvidence(tenant, "different", encrypted));
    await assert.rejects(() => openSecret("different", "credential", secret));
    await assert.rejects(() =>
      openSecret(tenant, "credential", {
        ...secret,
        nonce: secret.nonce + "!",
      }),
    );
    const next = "data-" + randomBytes(16).toString("hex");
    await write(next, randomBytes(32));
    ring.keys.push(next);
    ring.checksums[next] = createHash("sha256")
      .update(await readFile(join(directory, next)))
      .digest("hex");
    await write("keyring.json", JSON.stringify(ring));
    const migrated = await encryptEvidence(
      tenant,
      evidence,
      await decryptEvidence(tenant, evidence, encrypted),
      next,
    );
    const migratedSecret = await sealSecret(
      tenant,
      "credential",
      await openSecret(tenant, "credential", secret),
      next,
    );
    assert.equal(evidenceKeyId(migrated), next);
    assert.deepEqual(await decryptEvidence(tenant, evidence, migrated), plain);
    assert.deepEqual(await openSecret(tenant, "credential", migratedSecret), {
      synthetic: true,
    });
    await assert.rejects(() =>
      openSecret(tenant, "credential", {
        ...migratedSecret,
        key_version: "data-v1",
      }),
    );
    await durableReplace(join(directory, "evidence"), migrated);
    assert.deepEqual(await readFile(join(directory, "evidence")), migrated);
    ring.active = next;
    ring.keys = [next];
    ring.checksums = { [next]: ring.checksums[next] };
    await write("keyring.json", JSON.stringify(ring));
    await unlink(join(directory, "data"));
    assert.equal((await dataKey()).id, next);
    assert.equal(
      await opaqueIdentity(tenant, "stable-fixture"),
      independentIdentity,
    );
    assert.deepEqual(await decryptEvidence(tenant, evidence, migrated), plain);
    assert.deepEqual(await openSecret(tenant, "credential", migratedSecret), {
      synthetic: true,
    });
    await assert.rejects(
      () => decryptEvidence(tenant, evidence, encrypted),
      /version_unavailable/,
    );
    await assert.rejects(
      () => openSecret(tenant, "credential", secret),
      /version_unavailable/,
    );
    await chmod(join(directory, next), 0o644);
    await assert.rejects(() => dataKey(), /unsafe/);
    await chmod(join(directory, next), 0o600);
    await unlink(join(directory, next));
    await assert.rejects(() => dataKey());
    await symlink(join(directory, "identity"), join(directory, next));
    await assert.rejects(() => dataKey());
  } finally {
    for (const [name, value] of [
      ["DATA_KEY_FILE", previous.data],
      ["IDENTITY_KEY_FILE", previous.identity],
      ["DATA_KEY_LAYOUT", previous.layout],
    ]) {
      if (value) process.env[name!] = value;
      else delete process.env[name!];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
