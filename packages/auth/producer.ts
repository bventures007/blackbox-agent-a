import { createHash, createHmac } from "node:crypto";
import { equal } from "./index.js";
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export function signature(
  key: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: unknown,
) {
  const digest = createHash("sha256").update(canonical(body)).digest("hex");
  return createHmac("sha256", key)
    .update(`POST\n${path}\n${timestamp}\n${nonce}\n${digest}`)
    .digest("hex");
}
export function validSignature(
  key: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: unknown,
  supplied: string,
) {
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^[0-9a-f-]{36}$/.test(nonce)
  )
    return false;
  return equal(signature(key, path, timestamp, nonce, body), supplied);
}
