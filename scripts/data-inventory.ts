/** Inventory drift gate, not provider permission or independent acceptance. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import pg from "pg";
import { datasetRecord } from "../packages/contracts/records.js";
import {
  lifecycleObservation,
  recordObservation,
} from "../packages/contracts/index.js";
import { stockQuery } from "../packages/connectors/shopify-stock.js";
import { fulfillmentsQuery } from "../packages/connectors/shopify-fulfillments.js";
import { allocationsQuery } from "../packages/connectors/shopify-allocations.js";
import { sourceOrderQuery } from "../packages/connectors/shopify-source.js";
import { canonicalContract } from "../packages/runtime/compatibility.js";
const root = new URL("../", import.meta.url);
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function requireCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error("data_inventory: " + message);
}
function leaves(schema: any, path = ""): [string, any][] {
  const union = schema.anyOf ?? schema.oneOf;
  if (union)
    return union
      .filter((x: any) => x.type !== "null")
      .flatMap((x: any) => leaves(x, path));
  if (schema.type === "object") {
    requireCheck(
      schema.properties && schema.additionalProperties === false,
      "unbounded canonical object requires explicit review",
    );
    return Object.entries(schema.properties).flatMap(([key, value]) =>
      leaves(value, path ? path + "." + key : key),
    );
  }
  if (schema.type === "array") return leaves(schema.items, path + "[]");
  requireCheck(
    schema.type || "const" in schema || schema.enum,
    "unrecognized canonical leaf",
  );
  return [[path, schema]];
}
// Only the current static read-only selection syntax is supported. New query
// forms require explicit inventory review; this is not a general GraphQL parser.
export function selectionLeaves(query: string): string[] {
  let depth = 0,
    text = "";
  for (const c of query) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (!depth) text += c;
    requireCheck(depth >= 0, "unbalanced query arguments");
  }
  requireCheck(depth === 0 && text.includes("{"), "unsupported query");
  const body = text.slice(text.indexOf("{"));
  requireCheck(
    /^[A-Za-z0-9_{}\s]+$/.test(body),
    "unsupported selection syntax requires review",
  );
  const tokens = body.match(/[A-Za-z_][A-Za-z_0-9]*|[{}]/g)!;
  let i = 0;
  function group(prefix: string[]): string[] {
    requireCheck(tokens[i++] === "{", "missing selection");
    const result: string[] = [];
    while (tokens[i] !== "}") {
      const name = tokens[i++];
      requireCheck(
        typeof name === "string" && /^[A-Za-z_]\w*$/.test(name),
        "invalid selection field",
      );
      const path = [...prefix, name];
      if (tokens[i] === "{") result.push(...group(path));
      else result.push(path.join("."));
    }
    i++;
    return result;
  }
  const result = group([]);
  requireCheck(
    i === tokens.length && new Set(result).size === result.length,
    "ambiguous selections",
  );
  return result;
}
export async function readInventory(): Promise<any> {
  return JSON.parse(
    await readFile(new URL("docs/contracts/data-inventory.json", root), "utf8"),
  );
}
export function validateDatabaseColumns(value: any, rows: any[]) {
  const expected = new Map<string, any>(
    value.fields
      .filter((row: any) => row.path.startsWith("database."))
      .map((row: any) => [row.path, row]),
  );
  requireCheck(rows.length === expected.size, "database column count drift");
  const seen = new Set<string>();
  for (const row of rows) {
    const path = `database.${row.table_name}.${row.column_name}`;
    const field = expected.get(path);
    requireCheck(
      !seen.has(path) &&
        field &&
        field.sql_type === row.data_type &&
        field.nullable === (row.is_nullable === "YES"),
      "database column drift " + path,
    );
    seen.add(path);
  }
  return seen.size;
}
async function validateDatabase(value: any) {
  requireCheck(
    process.env.ADMIN_DATABASE_URL,
    "ADMIN_DATABASE_URL required for --database",
  );
  const client = new pg.Client({
    connectionString: process.env.ADMIN_DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  try {
    await client.connect();
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const rows = (
      await client.query(`SELECT c.table_name,c.column_name,c.data_type,c.is_nullable
      FROM information_schema.columns c JOIN information_schema.tables t
      USING(table_catalog,table_schema,table_name)
      WHERE c.table_schema='bb' AND t.table_type='BASE TABLE'
      ORDER BY c.table_name,c.ordinal_position`)
    ).rows;
    const count = validateDatabaseColumns(value, rows);
    await client.query("COMMIT");
    return count;
  } finally {
    await client.end();
  }
}
export async function validateInventory(value: any) {
  requireCheck(
    value?.schema_version === 1 && Array.isArray(value.fields),
    "missing format/fields",
  );
  const fields = new Map<string, any>();
  for (const row of value.fields) {
    requireCheck(
      typeof row.path === "string" && !fields.has(row.path),
      "duplicate/missing field path",
    );
    for (const name of [
      "purpose",
      "classification",
      "placement",
      "retention",
      "authorized_readers",
    ])
      requireCheck(
        typeof row[name] === "string" &&
          row[name].length > 0 &&
          !row[name].includes("REVIEW_REQUIRED"),
        "unclassified " + row.path,
      );
    for (const [field, group] of [
      ["classification", "classifications"],
      ["placement", "placements"],
      ["retention", "retention_rules"],
      ["authorized_readers", "reader_groups"],
    ])
      requireCheck(
        typeof value[group]?.[row[field]] === "string",
        "unknown policy reference " + row.path,
      );
    requireCheck(
      Array.isArray(row.derivation_dependencies) &&
        row.derivation_dependencies.length,
      "missing derivation dependency " + row.path,
    );
    fields.set(row.path, row);
  }
  const canonical = new Map<string, any>();
  for (const schema of (z.toJSONSchema(datasetRecord) as any).oneOf)
    for (const [path, leaf] of leaves(schema))
      canonical.set(
        "canonical." + schema.properties.dataset.const + "." + path,
        leaf,
      );
  for (const [namespace, schema] of [
    ["lifecycle", z.toJSONSchema(lifecycleObservation)],
    ["record", z.toJSONSchema(recordObservation)],
  ] as const) {
    const input = structuredClone(schema) as any;
    if (namespace === "record") delete input.properties.record;
    for (const [path, leaf] of leaves(input))
      canonical.set("canonical." + namespace + "." + path, leaf);
  }
  requireCheck(
    [...fields.keys()].filter((p) => p.startsWith("canonical.")).length ===
      canonical.size,
    "canonical field count drift",
  );
  for (const [path, schema] of canonical)
    requireCheck(
      fields.has(path) &&
        canonicalContract(fields.get(path).schema) ===
          canonicalContract(schema),
      "canonical shape drift " + path,
    );
  const queries = {
    orders: sourceOrderQuery("orders"),
    payments: sourceOrderQuery("payments"),
    refunds: sourceOrderQuery("refunds"),
    stock: stockQuery,
    fulfillments: fulfillmentsQuery,
    allocations: allocationsQuery,
  };
  let providerFields = 0;
  for (const [capability, query] of Object.entries(queries)) {
    requireCheck(
      value.provider_query_sha256?.[capability] === digest(query),
      "provider query changed " + capability,
    );
    const paths = selectionLeaves(query);
    providerFields += paths.length;
    const prefix = "provider.shopify." + capability + ".";
    requireCheck(
      [...fields.keys()].filter((p) => p.startsWith(prefix)).length ===
        paths.length,
      "provider selection count drift",
    );
    for (const path of paths) {
      const row = fields.get(prefix + path);
      requireCheck(
        row &&
          typeof row.normalization === "string" &&
          row.normalization.length >= 20 &&
          !row.normalization.includes("REVIEW_REQUIRED"),
        "unreviewed provider mapping " + path,
      );
    }
  }
  requireCheck(
    Object.keys(value.reviewed_source_sha256 ?? {}).length >= 13,
    "missing source review boundary",
  );
  for (const [path, sha] of Object.entries(value.reviewed_source_sha256)) {
    requireCheck(
      (path === "crates/domain/src/reader.rs" ||
        /^packages\/[a-z0-9/-]+\.ts$/.test(path)) &&
        !path.includes(".."),
      "unsafe source reference",
    );
    requireCheck(
      digest(await readFile(new URL(path, root))) === sha,
      "mapping/contract source changed " + path,
    );
  }
  const release = JSON.parse(
    await readFile(new URL("release/compatibility.json", root), "utf8"),
  );
  requireCheck(
    canonicalContract(value.reviewed_migrations) ===
      canonicalContract(release.migrations),
    "database migration changed; review actual columns and JSON boundaries",
  );
  return {
    fields: fields.size,
    canonical_fields: canonical.size,
    provider_selected_fields: providerFields,
    database_columns: [...fields.keys()].filter((p) =>
      p.startsWith("database."),
    ).length,
  };
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    requireCheck(
      process.argv.slice(2).every((arg) => arg === "--database"),
      "unknown option",
    );
    const inventory = await readInventory();
    const result = await validateInventory(inventory);
    console.log(
      JSON.stringify({
        status: "passed",
        ...result,
        ...(process.argv.includes("--database")
          ? { observed_database_columns: await validateDatabase(inventory) }
          : {}),
        limitation:
          "Inventory drift validation only; not live-provider permission or independent acceptance.",
      }),
    );
  } catch (error) {
    // Do not print connection strings or arbitrary database errors.
    console.error(
      error instanceof Error && error.message.startsWith("data_inventory:")
        ? error.message
        : "data_inventory_check_failed",
    );
    process.exitCode = 1;
  }
}
