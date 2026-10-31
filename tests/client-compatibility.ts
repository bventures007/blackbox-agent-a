import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const runtime = process.env.TEST_RUNTIME_DIR ?? resolve(".runtime");
const { b, states } = JSON.parse(
  await readFile(join(runtime, "slice-case.json"), "utf8"),
);
const directory = join(runtime, "inspector");
await mkdir(directory, { recursive: true, mode: 0o700 });
const keyFile = join(directory, "agent-key");
await writeFile(keyFile, b.agent, { mode: 0o600 });
const config = join(directory, "config.json");
await writeFile(
  config,
  JSON.stringify({
    mcpServers: {
      blackbox: {
        command: process.execPath,
        args: ["--import", "tsx", resolve("packages/mcp/main.ts")],
        env: {
          BLACKBOX_AGENT_KEY_FILE: keyFile,
          BLACKBOX_API_URL: process.env.BLACKBOX_API_URL!,
          PUBLIC_PORT: process.env.PUBLIC_PORT!,
        },
      },
    },
  }),
  { mode: 0o600 },
);
async function invoke(args: string[]) {
  return new Promise<any>((done, fail) => {
    const p = spawn(
      process.execPath,
      [
        "node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js",
        "--cli",
        "--config",
        config,
        "--server",
        "blackbox",
        "--format",
        "json",
        "--client-config",
        join(directory, "client.json"),
        ...args,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MCP_STORAGE_DIR: directory,
          MCP_CLIENT_CONFIG_PATH: join(directory, "client.json"),
          MCP_INSPECTOR_LOG_DIR: directory,
          MCP_INSPECTOR_OAUTH_STATE_PATH: join(directory, "oauth.json"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (x) => (stdout += x));
    p.stderr.on("data", (x) => (stderr += x));
    p.on("close", (code) => {
      if (code !== 0)
        return fail(
          Error(`Inspector failed (${code}): ${stderr.slice(0, 500)}`),
        );
      try {
        done(JSON.parse(stdout));
      } catch {
        fail(Error("Inspector output was not JSON"));
      }
    });
  });
}
const listed = await invoke(["--method", "tools/list", "--strict"]);
assert.ok(JSON.stringify(listed).includes("get_business_state"));
const answer = await invoke([
  "--method",
  "tools/call",
  "--tool-name",
  "get_business_state",
  "--tool-args-json",
  JSON.stringify({ entity_id: b.entities[0] }),
]);
assert.ok(JSON.stringify(answer).includes("captured_minor"));
assert.ok(!JSON.stringify(answer).includes("unauthorized"));
function business(value: any): any {
  if (value && typeof value === "object") {
    if ("captured_minor" in value && "payment_status" in value) return value;
    for (const child of Object.values(value)) {
      const found = business(child);
      if (found) return found;
    }
  }
  if (typeof value === "string" && value.startsWith("{")) {
    try {
      return business(JSON.parse(value));
    } catch {}
  }
}
const state = business(answer);
assert.ok(state);
assert.equal(state.payment_status, "paid");
assert.ok([11900, 5573].includes(state.captured_minor));
assert.equal(state.outstanding_minor, 0);

console.log(
  JSON.stringify({
    client: "Official MCP Inspector CLI",
    version: "2.13.0",
    transport: "stdio",
    result: "passed",
    checks: [
      "strict_tool_schema_discovery",
      "authenticated_persisted_state_call",
    ],
    limitations: ["No LLM dialogue tested", "No cloud reachability claimed"],
  }),
);
