import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
test("emitted diagnostic lines are valid JSON and strip secret/PII canaries before storage", async () => {
  const root = resolve(".runtime/test-logs");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "run-"));
  try {
    await new Promise<void>((done, fail) => {
      const p = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          "import {log} from './packages/diagnostics/index.ts';log('source.fetched',{record_count:2,authorization:'secret-canary',customer_name:'private-canary'});log('worker.failed',{});",
        ],
        {
          env: { ...process.env, LOG_DIR: dir, COMPONENT: "worker" },
          stdio: "ignore",
        },
      );
      p.on("error", fail);
      p.on("close", (code) =>
        code === 0 ? done() : fail(Error("logger process failed")),
      );
    });
    const text = await readFile(join(dir, "worker.jsonl"), "utf8");
    assert.ok(!text.includes("secret-canary"));
    assert.ok(!text.includes("private-canary"));
    const records = text
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(records.length, 2);
    assert.equal(records[0].record_count, 2);
    assert.equal(records[1].level, "ERROR");
    assert.equal(records[1].severity_number, 50);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
