import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  workerCount,
  machineWorkers,
  selectWorkloads,
  cacheWorkloads,
  readCache,
  verifyWorkloads,
  portableWorkloads,
  restoreWorkloads,
} from "./benchmark-plan.mjs";
import { digest } from "./wasmbench.mjs";
test("quarter-core default works on small and large machines, with explicit caps", () => {
  assert.equal(workerCount(undefined, 16), 4);
  assert.equal(workerCount(undefined, 2), 1);
  assert.equal(workerCount("50%", 16), 8);
  assert.equal(workerCount("3", 16), 3);
  for (const v of ["0%", "101%", "17", "0", "wat"])
    assert.throws(() => workerCount(v, 16));
  assert.equal(machineWorkers("local=25%,hub=50%", "hub"), "50%");
  assert.equal(machineWorkers("local=25%", "hub"), "25%");
});
test("selects exact contracts, corpora and families, with explicit feature scope", () => {
  const ws = [
    "applications/foo",
    "wago/qoi/encode",
    "wago/qoi/decode",
    "mechanisms/call",
    "features/simd/add/64",
  ].map((id) => ({ id }));
  assert.equal(selectWorkloads(ws).length, 4);
  assert.equal(selectWorkloads(ws, { kind: "features" }).length, 1);
  assert.equal(
    selectWorkloads(ws, { kind: "both", corpus: ["qoi", "features/simd"] })
      .length,
    3,
  );
  assert.throws(() => selectWorkloads(ws, { corpus: ["features/simd"] }));
  assert.throws(() => selectWorkloads(ws, { corpus: ["missing"] }));
});
test("reuses content-addressed Wasm and fixtures, detects mutations, and relocates for SSH", async () => {
  const root = await mkdtemp(join(tmpdir(), "bench-cache-"));
  try {
    const artifact = join(root, "input.wasm"),
      input = join(root, "fixture");
    await writeFile(artifact, "wasm");
    await writeFile(input, "input");
    await cacheWorkloads(root, [
      {
        id: "wago/test",
        artifact,
        sha256: digest("wasm"),
        command: { files: { input: { path: input, sha256: digest("input") } } },
      },
    ]);
    const ws = await readCache(root);
    await verifyWorkloads(ws);
    assert.deepEqual(restoreWorkloads(root, portableWorkloads(root, ws)), ws);
    await writeFile(ws[0].artifact, "changed");
    await assert.rejects(() => verifyWorkloads(ws), /Cached artifact changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
