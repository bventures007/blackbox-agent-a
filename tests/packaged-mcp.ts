import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFile, chmod, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const base = process.env.BLACKBOX_API_URL!,
  stage = process.env.TEST_STAGE!,
  project = process.env.TEST_PROJECT!,
  hostPath = process.env.TEST_BRIDGE_PATH!;
let cookie = "",
  csrf = "";
async function api(path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: base,
      "content-type": "application/json",
      cookie,
      "x-blackbox-csrf": csrf,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  if (response.headers.has("set-cookie"))
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  const value = await response.json();
  assert.ok(response.ok, "synthetic_owner_API_failed");
  return value;
}
const login = await api("/v1/login", { key: process.env.TEST_OWNER_KEY! });
csrf = login.csrf;
const example = await api("/v1/example", {}),
  first = await api("/v1/agents", { name: "Packaged MCP first" }),
  second = await api("/v1/agents", { name: "Packaged MCP independent" });
const bridgeEnv: Record<string, string> = { PATH: hostPath };
for (const name of [
  "HOME",
  "USER",
  "TMPDIR",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
]) {
  if (process.env[name]) bridgeEnv[name] = process.env[name]!;
}
// Deliberate ambient overrides must not redirect this installation or activate fixture services.
bridgeEnv.BB_PROJECT =
  "blackbox-a-" + randomUUID().replaceAll("-", "").slice(0, 12);
bridgeEnv.COMPOSE_PROJECT_NAME = bridgeEnv.BB_PROJECT;
bridgeEnv.BB_PORT = "18764";
bridgeEnv.COMPOSE_PROFILES = "test";
const clients: Client[] = [];
const keyFile = join(stage, ".runtime", "client-" + randomUUID() + ".key");
function ids() {
  return execFileSync(
    "docker",
    [
      "ps",
      "--filter",
      "label=com.docker.compose.project=" + project,
      "--filter",
      "label=com.docker.compose.service=mcp",
      "--format",
      "{{.ID}}",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
}
async function connect(env: Record<string, string>) {
  const client = new Client({ name: "actual-packaged-client", version: "1" });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({
      command: join(stage, "blackbox"),
      args: ["mcp"],
      env: { ...bridgeEnv, ...env },
      stderr: "pipe",
    }),
  );
  return client;
}
async function state(client: Client) {
  return client.callTool({
    name: "get_business_state",
    arguments: { entity_id: example.entity_id },
  });
}
const checks: string[] = [];
try {
  const denied = spawnSync(join(stage, "blackbox"), ["mcp"], {
    env: { ...bridgeEnv, BLACKBOX_AGENT_KEY: process.env.TEST_OWNER_KEY! },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(denied.status, 1);
  assert.equal(denied.stdout, "");
  assert.ok(
    !denied.stderr.includes(process.env.TEST_OWNER_KEY!),
    "owner_key_exposed",
  );
  const client = await connect({ BLACKBOX_AGENT_KEY: first.key });
  const tools = await client.listTools();
  assert.ok(
    tools.tools.length >= 8 &&
      tools.tools.every((tool) => tool.annotations?.readOnlyHint === true),
  );
  const unsupported = await client.callTool({
    name: "execute_sql",
    arguments: { sql: "DELETE FROM bb.journal" },
  });
  assert.equal(unsupported.isError, true);
  let answer: Awaited<ReturnType<typeof state>> | undefined;
  for (let attempt = 0; attempt < 40; attempt++) {
    answer = await state(client);
    if (!answer.isError) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(answer && !answer.isError, "packaged_query_failed");
  const payload = JSON.parse((answer.content as { text: string }[])[0].text);
  assert.equal(payload.result.captured_minor, 11900);
  assert.equal(payload.result.refunded_minor, 2380);
  const running = ids();
  assert.equal(running.length, 1);
  const inspect = JSON.parse(
    execFileSync("docker", ["inspect", running[0]], { encoding: "utf8" }),
  )[0];
  const environment = Object.fromEntries(
    inspect.Config.Env.map((line: string) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
  );
  const allowed = new Set([
    "PATH",
    "NODE_VERSION",
    "YARN_VERSION",
    "BLACKBOX_AGENT_KEY",
    "BLACKBOX_API_URL",
    "CONTAINER_MCP_BRIDGE",
    "PUBLIC_PORT",
    "NODE_DISABLE_COMPILE_CACHE",
  ]);
  assert.ok(
    Object.keys(environment).every((name) => allowed.has(name)),
    "bridge_has_unexpected_environment_names",
  );
  assert.ok(
    environment.BLACKBOX_AGENT_KEY === first.key,
    "wrong_named_agent_key",
  );
  assert.ok(
    inspect.Mounts.every(
      (mount: { Type: string; Destination: string }) =>
        mount.Type === "tmpfs" && mount.Destination === "/tmp",
    ),
    "bridge_has_host_or_database_mount",
  );
  assert.ok(
    inspect.HostConfig.ReadonlyRootfs &&
      inspect.HostConfig.CapDrop.includes("ALL") &&
      inspect.HostConfig.SecurityOpt.includes("no-new-privileges:true"),
    "bridge_missing_process_boundary",
  );
  assert.ok(
    inspect.Config.User === `${process.getuid!()}:${process.getgid!()}` &&
      inspect.Config.User !== "0:0",
    "bridge_privileged_user",
  );
  assert.ok(
    inspect.HostConfig.Memory === 268435456 &&
      inspect.HostConfig.PidsLimit === 64,
    "bridge_resource_limits_missing",
  );
  checks.push(
    "actual_wrapper_SDK_MCP_returns_persisted_answer_without_host_Node_or_Rust_on_PATH",
    "exact_own_project_ignores_ambient_project_port_and_profile_overrides",
    "actual_unprivileged_readonly_container_has_only_agent_key_no_DB_or_installation_material",
    "owner_key_and_unsupported_write_tools_denied",
  );
  await api("/v1/agents/" + first.credential_id + "/revoke", {});
  const began = performance.now();
  const revoked = await state(client);
  assert.equal(revoked.isError, true);
  assert.ok(performance.now() - began < 5000, "revocation_deadline_exceeded");
  assert.equal(
    JSON.parse((revoked.content as { text: string }[])[0].text).error,
    "unauthorized",
  );
  await client.close();
  await writeFile(keyFile, second.key, { mode: 0o600, flag: "wx" });
  await chmod(keyFile, 0o644);
  const unsafe = spawnSync(join(stage, "blackbox"), ["mcp"], {
    env: { ...bridgeEnv, BLACKBOX_AGENT_KEY_FILE: keyFile },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(unsafe.status, 1);
  assert.equal(unsafe.stdout, "");
  assert.ok(!unsafe.stderr.includes(second.key), "agent_key_exposed");
  await chmod(keyFile, 0o600);
  const other = await connect({ BLACKBOX_AGENT_KEY_FILE: keyFile });
  const stillAllowed = await state(other);
  assert.ok(!stillAllowed.isError, "independent_agent_was_revoked");
  checks.push(
    "existing_stdio_connection_denies_revoked_agent_within_five_seconds",
    "separate_agent_survives_and_protected_key_file_works_while_unsafe_mode_is_denied",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      checks,
      container_environment_names: Object.keys(environment).sort(),
      bridge_memory_limit_bytes: inspect.HostConfig.Memory,
    }),
  );
} finally {
  for (const client of clients) await client.close().catch(() => {});
  await unlink(keyFile).catch(() => {});
  const deadline = Date.now() + 15000;
  while (ids().length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200));
  const remaining = ids();
  if (remaining.length) {
    execFileSync("docker", ["rm", "-f", ...remaining], { stdio: "ignore" });
    throw Error("stdio_close_left_test_bridge_container_running");
  }
}
