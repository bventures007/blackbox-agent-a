import { createHash } from "node:crypto";
import type pg from "pg";
import manifest from "../../release/compatibility.json" with { type: "json" };

export function canonicalContract(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalContract).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalContract(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const runtimeContract = manifest.runtime;
export const runtimeFingerprint = createHash("sha256")
  .update(canonicalContract(runtimeContract))
  .digest("hex");

if (
  runtimeFingerprint !==
  "f44009de0ee45cf3b5d92fa8f5360099077a62fa7d3bf680384b03e1aa2090b6"
)
  throw Error("unsupported_compiled_runtime_contract");

export async function verifyDatabaseContract(database: Pick<pg.Pool, "query">) {
  try {
    const metadata = await database.query(
      "SELECT contract,state FROM bb.runtime_contract",
    );
    const migrations = await database.query(
      "SELECT version AS file,sha256 FROM bb.schema_migrations ORDER BY version",
    );
    const version = await database.query(
      "SELECT current_setting('server_version_num')::integer/10000 AS major",
    );
    if (
      metadata.rows.length !== 1 ||
      metadata.rows[0].state !== "active" ||
      canonicalContract(metadata.rows[0].contract) !==
        canonicalContract(runtimeContract) ||
      canonicalContract(migrations.rows) !==
        canonicalContract(manifest.migrations) ||
      !runtimeContract.postgres_read.includes(version.rows[0]?.major)
    )
      throw Error("incompatible");
  } catch {
    throw Error(
      "database_contract_incompatible_or_fenced: use the matching host upgrade or isolated restore before starting traffic",
    );
  }
}

export async function verifyEngineContract(address: string | undefined) {
  if (!address) throw Error("engine_address_required");
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const response = await fetch(address + "/health", {
        signal: AbortSignal.timeout(2000),
        redirect: "error",
      });
      // Internal fixed-origin protocol metadata is small and contains no business data.
      const reader = response.body?.getReader();
      if (!reader) throw Error("engine_contract_empty");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16384) throw Error("engine_contract_oversized");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        response.ok &&
        value.service === "engine" &&
        value.rpc_version === runtimeContract.engine_rpc &&
        canonicalContract(value.runtime_contract) ===
          canonicalContract(runtimeContract)
      )
        return;
      throw Error("engine_contract_incompatible");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("engine_contract_")
      )
        throw error;
      if (Date.now() >= deadline)
        throw Error(
          "engine_contract_unavailable: start the matching engine before application traffic",
        );
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
