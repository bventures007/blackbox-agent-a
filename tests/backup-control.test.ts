import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  chmod,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupStatus,
  requestBackup,
} from "../packages/application/backup-control.js";
import type { Principal } from "../packages/auth/index.js";

test("host backup status never exposes unvalidated paths or keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blackbox-backup-status-"));
  try {
    assert.equal((await backupStatus(directory)).state, "not_configured");
    await writeFile(
      join(directory, "secret"),
      JSON.stringify({ destination: "/sensitive", recipient: "private" }),
      { mode: 0o600 },
    );
    await symlink(join(directory, "secret"), join(directory, "backup.json"));
    assert.equal((await backupStatus(directory)).state, "unknown");
    await rm(join(directory, "backup.json"));
    await writeFile(
      join(directory, "backup.json"),
      JSON.stringify({ state: "completed", destination: "/sensitive" }),
      { mode: 0o600 },
    );
    const result = await backupStatus(directory);
    assert.equal(result.state, "unknown");
    assert.ok(!JSON.stringify(result).includes("sensitive"));
    await chmod(join(directory, "backup.json"), 0o644);
    assert.equal((await backupStatus(directory)).state, "unknown");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent owner backup requests produce one bounded action without a path or command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blackbox-backup-request-"));
  const principal = {
    principal_id: "c3b6532d-78ca-433f-8611-903ea5b30fe7",
    tenant_id: "4e057508-15a5-4b20-83cd-0860a0216535",
  } as Principal;
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => requestBackup(principal, directory)),
    );
    assert.ok(results.every((value) => value.queued));
    const value = JSON.parse(
      await readFile(join(directory, "backup.json"), "utf8"),
    );
    assert.deepEqual(
      Object.keys(value).sort(),
      [
        "schema_version",
        "request_id",
        "requested_at",
        "principal_id",
        "tenant_id",
      ].sort(),
    );
    assert.equal(value.tenant_id, principal.tenant_id);
    const before = value.request_id;
    await requestBackup(principal, directory);
    assert.equal(
      JSON.parse(await readFile(join(directory, "backup.json"), "utf8"))
        .request_id,
      before,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
