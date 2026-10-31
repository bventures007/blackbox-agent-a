import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { evidenceMaintenanceStatus } from "../packages/application/evidence-control.js";

test("evidence cleanup status is private, bounded and bound to the installation owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blackbox-evidence-status-")),
    tenant = randomUUID();
  const path = join(directory, "evidence-policy.json"),
    now = new Date().toISOString();
  const value = {
    schema_version: 1,
    owner_workspace_id: tenant,
    observed_at: now,
    state: "scheduled",
    last_checked_at: now,
    last_attempt: null,
    last_completed: null,
    next_check_at: now,
    check_interval_seconds: 3600,
    orphan_interval_seconds: 86400,
    scheduler_heartbeat: now,
    copies: {
      observed_at: now,
      state: "available",
      generations: [{ generation: "a".repeat(32), recoverable_cutoff: now }],
      total: 1,
      truncated: false,
    },
  };
  const save = async (v: unknown) => {
    await writeFile(path, JSON.stringify(v), { mode: 0o600 });
  };
  try {
    assert.equal(
      (await evidenceMaintenanceStatus(tenant, directory)).state,
      "unavailable",
    );
    await save(value);
    const good = await evidenceMaintenanceStatus(tenant, directory);
    assert.equal(good.state, "scheduled");
    assert.equal(good.scheduler_alive, true);
    assert.ok(!JSON.stringify(good).includes(tenant));
    await save({
      ...value,
      copies: {
        ...value.copies,
        state: "unavailable",
        generations: [],
        total: null,
      },
    });
    const missing = await evidenceMaintenanceStatus(tenant, directory);
    assert.equal(missing.state, "scheduled");
    assert.deepEqual("copies" in missing ? missing.copies : null, {
      ...value.copies,
      state: "unavailable",
      generations: [],
      total: null,
    });
    await save(value);
    const other = await evidenceMaintenanceStatus(randomUUID(), directory);
    assert.deepEqual(other, {
      state: "unavailable",
      scheduler_alive: false,
      status_stale: true,
    });
    for (const v of [
      { ...value, destination: "/private/destination" },
      { ...value, scheduler_heartbeat: "malformed" },
      { ...value, state: "secret" },
    ]) {
      await save(v);
      assert.deepEqual(
        await evidenceMaintenanceStatus(tenant, directory),
        other,
      );
    }
    await save({
      ...value,
      observed_at: "2020-01-01T00:00:00Z",
      scheduler_heartbeat: "2020-01-01T00:00:00Z",
    });
    const stale = await evidenceMaintenanceStatus(tenant, directory);
    assert.equal(stale.scheduler_alive, false);
    assert.equal(stale.status_stale, true);
    await save(value);
    await chmod(path, 0o644);
    assert.deepEqual(await evidenceMaintenanceStatus(tenant, directory), other);
    await rm(path);
    await symlink(join(directory, "target"), path);
    assert.deepEqual(await evidenceMaintenanceStatus(tenant, directory), other);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
