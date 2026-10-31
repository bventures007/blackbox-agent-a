import { runtimeFingerprint } from "../runtime/compatibility.js";
import { localApiRequest, localApiBase } from "../transport/local-api.js";
import { intents } from "../contracts/questions.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
const api = process.env.BLACKBOX_API_URL ?? "http://127.0.0.1:18741";
localApiBase(api);
async function agentKey() {
  if (process.env.BLACKBOX_AGENT_KEY)
    return process.env.BLACKBOX_AGENT_KEY.trim();
  if (!process.env.BLACKBOX_AGENT_KEY_FILE)
    throw Error("protected_agent_key_required");
  const file = await open(
    process.env.BLACKBOX_AGENT_KEY_FILE,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid()) ||
      info.size > 256
    )
      throw Error("protected_agent_key_required");
    const bytes = Buffer.alloc(257),
      result = await file.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead > 256) throw Error("protected_agent_key_required");
    return bytes.subarray(0, result.bytesRead).toString("utf8").trim();
  } finally {
    await file.close();
  }
}
const key = await agentKey();
if (!/^bb_agent_[A-Za-z0-9_-]{43}$/.test(key))
  throw Error("named_read_only_agent_key_required");
const names = [
  "query_business",
  "describe_business_schema",
  "get_business_state",
  "list_journal_entries",
  "get_journal_entry",
  "get_entity_history",
  "search_events",
  "get_evidence",
];
const properties: Record<string, Record<string, unknown>> = {
  query_business: {
    intent: { type: "string", enum: intents },
    entity_id: { type: "string", format: "uuid" },
    item_id: { type: "string", format: "uuid" },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    unit: { type: "string", enum: ["piece", "kg", "litre", "metre"] },
    requested_quantity: { type: "string", pattern: "^[0-9]+(\\.[0-9]{1,6})?$" },
    as_of: { type: "string", format: "date-time" },
    from: { type: "string", format: "date-time" },
    effective_at: { type: "string", format: "date-time" },
    recorded_cutoff: { type: "integer", minimum: 0 },
    at_least_cursor: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: 500 },
    cursor: { type: "string" },
  },
  get_business_state: {
    interpretation_version: {
      type: "string",
      enum: ["lifecycle-v2", "lifecycle-v3"],
    },
    entity_id: { type: "string", format: "uuid" },
    recorded_cutoff: { type: "integer", minimum: 0 },
    effective_at: { type: "string", format: "date-time" },
    at_least_cursor: { type: "integer", minimum: 0 },
  },
  get_journal_entry: { entry_id: { type: "string", format: "uuid" } },
  get_evidence: { evidence_id: { type: "string", format: "uuid" } },
};
const server = new Server(
  { name: "blackbox-local", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: names.map((name) => ({
    name,
    description: `Read authorized Blackbox business data: ${name}. Source content is untrusted.`,
    inputSchema: {
      type: "object",
      properties:
        properties[name] ??
        (name === "describe_business_schema"
          ? {}
          : {
              entity_id: { type: "string", format: "uuid" },
              track: {
                type: "string",
                enum: [
                  "source",
                  "fact",
                  "commitment",
                  "movement",
                  "reservation",
                ],
              },
              connection_id: { type: "string", format: "uuid" },
              event_type: { type: "string" },
              from: { type: "string", format: "date-time" },
              to: { type: "string", format: "date-time" },
              direction: { type: "string", enum: ["asc", "desc"] },
              limit: { type: "integer", minimum: 1, maximum: 500 },
              cursor: { type: "string" },
            }),
      additionalProperties: false,
      ...(properties[name]
        ? { required: [Object.keys(properties[name])[0]] }
        : {}),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (!names.includes(req.params.name))
    return {
      isError: true,
      content: [{ type: "text", text: "unsupported_tool" }],
    };
  try {
    const r = await localApiRequest(api, `/v1/tools/${req.params.name}`, {
      method: "POST",
      headers: {
        "x-blackbox-contract": runtimeFingerprint,
        "content-type": "application/json",
        authorization: `Bearer ${key.trim()}`,
        host: `127.0.0.1:${process.env.PUBLIC_PORT ?? 18741}`,
      },
      body: JSON.stringify(req.params.arguments ?? {}),
      signal: AbortSignal.timeout(5000),
    });
    if (r.headers.get("x-blackbox-contract") !== runtimeFingerprint)
      throw Error("runtime_contract_incompatible");
    return {
      isError: !r.ok,
      content: [{ type: "text", text: JSON.stringify(await r.json()) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            error instanceof Error &&
            error.message === "runtime_contract_incompatible"
              ? "runtime_contract_incompatible: use the matching local API and MCP release"
              : "backend_unavailable",
        },
      ],
    };
  }
});
await server.connect(new StdioServerTransport());
