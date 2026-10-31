// Host-only bounded before/after probe. Emits counts/hashes, never record bodies.
// It is deliberately plain JS so the known previous Node image can execute it.
import pg from "pg";
import { readFile, open, rename } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
const db = new pg.Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
  max: 1,
  statement_timeout: 10000,
});
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? "[" + value.map(canonical).join(",") + "]"
      : "{" +
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
          .join(",") +
        "}";
const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const namePrefix = "Host upgrade verification ";
let operation;
try {
  const mode = process.argv[2];
  if (!["capture", "compare"].includes(mode)) throw Error("mode");
  const marker = JSON.parse(
    await readFile("/runtime/maintenance.json", "utf8"),
  );
  operation = marker.operation_id;
  if (marker.operation !== "upgrade" || !/^[a-f0-9-]{36}$/.test(operation))
    throw Error("marker");
  const internal = await readFile(process.env.INTERNAL_KEY_FILE, "utf8");
  const contract = (
    await db.query("SELECT contract,state FROM bb.runtime_contract")
  ).rows;
  if (contract.length !== 1 || contract[0].state !== "active")
    throw Error("contract");
  const headers = {
    "content-type": "application/json",
    "x-blackbox-internal": internal,
    "x-blackbox-contract": digest(contract[0].contract),
  };
  const deadline = Date.now() + 300000;
  async function call(path, body) {
    if (Date.now() > deadline) throw Error("budget");
    const response = await fetch("http://engine:8081" + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error("engine");
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) throw Error("response_budget");
    return JSON.parse(text);
  }
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      const response = await fetch("http://engine:8081/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (
        response.ok &&
        digest((await response.json()).runtime_contract) ===
          headers["x-blackbox-contract"]
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw Error("engine_not_ready");
  const tenants = (
    await db.query(
      "SELECT tenant_id,committed,applied FROM bb.heads ORDER BY tenant_id LIMIT 65",
    )
  ).rows;
  if (!tenants.length || tenants.length > 64) throw Error("workspace_budget");
  let saved;
  if (mode === "compare") {
    const file = await open("/runtime/upgrade-probes.json", "r");
    try {
      if ((await file.stat()).size > 1024 * 1024) throw Error("probe_budget");
      saved = JSON.parse(await file.readFile("utf8"));
    } finally {
      await file.close();
    }
    if (
      saved.operation_id !== operation ||
      !Array.isArray(saved.cases) ||
      saved.cases.length > 512
    )
      throw Error("probe_checkpoint");
  }
  const publication =
    mode === "compare"
      ? await (
          await import("/app/scripts/projection-rebuild.mjs")
        ).rebuildAll(db, call, marker.retry_builds ?? [])
      : null;
  const cases = [],
    asOf = saved?.as_of ?? new Date().toISOString();
  for (const tenant of tenants) {
    if (mode === "capture") {
      for (let i = 0; i < 1000; i++) {
        const head = (
          await db.query(
            "SELECT committed,applied FROM bb.heads WHERE tenant_id=$1",
            [tenant.tenant_id],
          )
        ).rows[0];
        if (head.applied === head.committed) {
          Object.assign(tenant, head);
          break;
        }
        const applied = await call("/v1/apply", {
          tenant_id: tenant.tenant_id,
        });
        if (!applied.processed) throw Error("outbox_not_progressing");
      }
    }
    const head = (
      await db.query(
        "SELECT committed,applied FROM bb.heads WHERE tenant_id=$1",
        [tenant.tenant_id],
      )
    ).rows[0];
    if (head.applied !== head.committed) throw Error("outbox_not_ready");
    // Only the verifier exists. There is no corresponding plaintext login key.
    const verifier = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name,expires_at)VALUES($1,$2,$3,'agent',$4,$5,now()+interval '10 minutes')",
      [
        tenant.tenant_id,
        randomUUID(),
        randomUUID(),
        verifier,
        namePrefix + operation,
      ],
    );
    let selected;
    if (saved)
      selected = saved.cases.filter((x) => x.tenant_id === tenant.tenant_id);
    else {
      const entities = (
        await db.query(
          "SELECT entity_id FROM bb.journal WHERE tenant_id=$1 AND record_type='source' GROUP BY entity_id ORDER BY entity_id LIMIT 2",
          [tenant.tenant_id],
        )
      ).rows;
      if (!entities.length)
        entities.push({ entity_id: "00000000-0000-0000-0000-000000000000" });
      selected = entities
        .flatMap(({ entity_id }) => [
          { path: "/v1/state", request: { entity_id } },
          ...[
            "orders.fulfillable",
            "orders.reservation_variance",
            "shipments.attention",
          ].map((intent) => ({
            path: "/v1/query",
            request: {
              request: {
                intent,
                entity_id,
                as_of: asOf,
                limit: 100,
                offset: 0,
              },
            },
          })),
        ])
        .map((x) => ({
          ...x,
          tenant_id: tenant.tenant_id,
          cutoff: Number(head.committed),
        }));
    }
    for (const item of selected) {
      if (
        !["/v1/state", "/v1/query"].includes(item.path) ||
        item.cutoff !== Number(head.committed)
      )
        throw Error("scope_changed");
      const answer = await call(item.path, {
        tenant_id: tenant.tenant_id,
        verifier,
        recorded_cutoff: item.cutoff,
        ...item.request,
        ...(saved && item.path === "/v1/state"
          ? { interpretation_version: item.interpretation_version }
          : {}),
      });
      // Cache selection is allowed to differ; business answer/cutoff must match.
      delete answer.read_path;
      delete answer.active_interpretation_version;
      delete answer.projection_generation;
      const hash = digest(answer);
      if (saved && hash !== item.sha256) throw Error("answer_changed");
      const interpretation_version =
        item.path === "/v1/state" ? answer.rule_version : undefined;
      cases.push({ ...item, interpretation_version, sha256: hash });
      if (saved && item.path === "/v1/state") {
        const current = await call(item.path, {
          tenant_id: tenant.tenant_id,
          verifier,
          recorded_cutoff: item.cutoff,
          ...item.request,
        });
        if (
          current.rule_version !== "lifecycle-v3" ||
          current.result.rule_version !== "lifecycle-v3" ||
          current.recorded_cutoff !== item.cutoff
        )
          throw Error("publication_version");
      }
    }
  }
  if (saved && cases.length !== saved.cases.length)
    throw Error("scope_missing");
  if (!saved) {
    const temporary = "/runtime/.upgrade-probes-" + randomUUID();
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({ operation_id: operation, as_of: asOf, cases }),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, "/runtime/upgrade-probes.json");
    const directory = await open("/runtime", "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  console.log(
    JSON.stringify({
      status: "passed",
      mode,
      workspaces: tenants.length,
      representative_answers: cases.length,
      answers_sha256: digest(cases),
      bodies_exposed: false,
      retained_interpretation_verified: mode === "compare",
      publication,
    }),
  );
} catch {
  console.error("upgrade_representative_verification_failed");
  process.exitCode = 1;
} finally {
  if (operation)
    await db.query(
      "UPDATE bb.credentials SET revoked_at=now() WHERE name=$1 AND revoked_at IS NULL",
      [namePrefix + operation],
    );
  await db.end();
}
