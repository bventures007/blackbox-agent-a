import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Host control boundary only; actual PG/Rust lifecycle proof is a separate suite.
// @ts-expect-error The host module deliberately remains plain JS for old tooling.
import { rebuildAll } from "../scripts/projection-rebuild.mjs";

function fixture() {
  const tenant = randomUUID(),
    failed = randomUUID();
  const previous: any[] = [
    { build_id: failed, state: "failed", retry_used: false },
  ];
  let open: any,
    committed = false,
    inserts = 0,
    auditFailure = false;
  const statements: string[] = [];
  const db = {
    query: async (sql: string, args: any[] = []) => {
      statements.push(sql);
      if (sql === "BEGIN") {
        committed = false;
        return { rows: [] };
      }
      if (sql === "COMMIT") {
        committed = true;
        return { rows: [] };
      }
      if (sql === "ROLLBACK") return { rows: [] };
      if (sql.startsWith("SELECT tenant_id FROM bb.heads"))
        return { rows: [{ tenant_id: tenant }] };
      if (sql.startsWith("SELECT * FROM bb.heads"))
        return {
          rows: [
            {
              applied: "10",
              committed: "10",
              projection_rule: "lifecycle-v2",
              projection_generation: randomUUID(),
            },
          ],
        };
      if (sql.startsWith("SELECT build_id,state"))
        return { rows: open ? [open] : [] };
      if (sql.startsWith("SELECT b.build_id")) return { rows: previous };
      if (sql.startsWith("INSERT INTO bb.projection_builds")) {
        inserts++;
        open = { build_id: args[1], state: "scanning" };
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO bb.security_audit")) {
        if (auditFailure) throw Error("synthetic_audit_failure");
        assert.equal(args[2], failed);
        previous[0].retry_used = true;
        return { rows: [] };
      }
      throw Error("unexpected_control_statement");
    },
  };
  return {
    tenant,
    failed,
    db,
    previous,
    statements,
    get inserts() {
      return inserts;
    },
    get open() {
      return open;
    },
    get committed() {
      return committed;
    },
    failAudit() {
      auditFailure = true;
    },
    failCandidate() {
      previous.unshift({ ...open, state: "failed", retry_used: false });
      open = undefined;
    },
  };
}

test("host retry authorizes one failed workspace/build pair, never an arbitrary retry", async () => {
  const f = fixture();
  const call = async () => {
    throw Error("must_not_call_engine");
  };
  for (const retry of [
    [],
    [{ tenant_id: randomUUID(), build_id: f.failed }],
    [{ tenant_id: f.tenant, build_id: randomUUID() }],
  ])
    await assert.rejects(
      () => rebuildAll(f.db, call, retry),
      /requires_explicit_repair/,
    );
  assert.equal(f.inserts, 0);
  for (const retry of [
    [{ tenant_id: f.tenant, build_id: f.failed, extra: true }],
    Array.from({ length: 65 }, () => ({
      tenant_id: f.tenant,
      build_id: f.failed,
    })),
    [{ tenant_id: "invalid", build_id: f.failed }],
  ])
    await assert.rejects(
      () => rebuildAll(f.db, call, retry),
      /invalid_retry_authorization/,
    );
  assert.equal(f.inserts, 0);
});

test("committed retry resumes after interruption but cannot authorize the next failed candidate", async () => {
  const f = fixture(),
    authorization = [{ tenant_id: f.tenant, build_id: f.failed }];
  await assert.rejects(
    () =>
      rebuildAll(
        f.db,
        async () => {
          assert.ok(f.committed);
          throw Error("synthetic_interrupt");
        },
        authorization,
      ),
    /synthetic_interrupt/,
  );
  assert.equal(f.inserts, 1);
  const replacement = f.open.build_id;
  assert.notEqual(replacement, f.failed);
  const result = await rebuildAll(
    f.db,
    async (_path: string, body: any) => {
      assert.equal(body.build_id, replacement);
      return { state: "published", recorded_cutoff: 10 };
    },
    authorization,
  );
  assert.equal(result.published, 1);
  assert.equal(f.inserts, 1);
  // The immutable retry audit consumes the old ID independently of clock order.
  f.failCandidate();
  f.previous.reverse();
  await assert.rejects(
    () =>
      rebuildAll(
        f.db,
        async () => {
          throw Error("must_not_call_engine");
        },
        authorization,
      ),
    /requires_explicit_repair/,
  );
  assert.equal(f.inserts, 1);
  assert.ok(!f.statements.some((s) => /^(DELETE|UPDATE)/.test(s)));
});

test("retry budget and failed audit prevent engine work", async () => {
  const f = fixture();
  for (let i = 0; i < 7; i++)
    f.previous.push({
      build_id: randomUUID(),
      state: "failed",
      retry_used: true,
    });
  await assert.rejects(
    () =>
      rebuildAll(
        f.db,
        async () => {
          throw Error("must_not_call_engine");
        },
        [{ tenant_id: f.tenant, build_id: f.failed }],
      ),
    /retained_generation_budget/,
  );
  assert.equal(f.inserts, 0);
  const g = fixture();
  g.failAudit();
  await assert.rejects(
    () =>
      rebuildAll(
        g.db,
        async () => {
          throw Error("must_not_call_engine");
        },
        [{ tenant_id: g.tenant, build_id: g.failed }],
      ),
    /synthetic_audit_failure/,
  );
  assert.equal(g.statements.at(-1), "ROLLBACK");
});
