import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import {
  sealCheckpoint,
  openCheckpoint,
} from "../packages/application/source-checkpoint.js";
test("opaque provider cursor is encrypted and tenant/connection/job bound, with strict control metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blackbox-cursor-")),
    prior = process.env.DATA_KEY_FILE;
  process.env.DATA_KEY_FILE = join(dir, "data");
  const tenant = randomUUID(),
    connection = randomUUID(),
    job = randomUUID();
  const value = {
    from: "2026-01-01T00:00:00Z",
    stage: "recent",
    pages: 1,
    after: "personal-canary@example.test",
  };
  try {
    await writeFile(process.env.DATA_KEY_FILE, randomBytes(32), {
      mode: 0o600,
    });
    const stored = await sealCheckpoint(tenant, connection, job, value);
    assert.equal(stored.after, null);
    assert.ok(!JSON.stringify(stored).includes(value.after));
    assert.deepEqual(
      await openCheckpoint(tenant, connection, job, stored),
      value,
    );
    for (const [t, c, j] of [
      [randomUUID(), connection, job],
      [tenant, randomUUID(), job],
      [tenant, connection, randomUUID()],
    ])
      await assert.rejects(() => openCheckpoint(t, c, j, stored));
    await assert.rejects(() => openCheckpoint(tenant, connection, job, value));
    await assert.rejects(() =>
      sealCheckpoint(tenant, connection, job, { ...value, extra: "private" }),
    );
    await assert.rejects(() =>
      sealCheckpoint(tenant, connection, job, {
        ...value,
        after: "x".repeat(4097),
      }),
    );
    await assert.rejects(() =>
      openCheckpoint(tenant, connection, job, {
        ...stored,
        sealed_after: {
          ...stored.sealed_after!,
          tag: Buffer.alloc(16).toString("base64"),
        },
      }),
    );
    const empty = await sealCheckpoint(tenant, connection, job, {
      ...value,
      after: null,
    });
    assert.ok(!("sealed_after" in empty));
  } finally {
    if (prior === undefined) delete process.env.DATA_KEY_FILE;
    else process.env.DATA_KEY_FILE = prior;
    await rm(dir, { recursive: true });
  }
});
