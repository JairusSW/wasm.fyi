// Build adapters once per host/session, independently of cached corpus artifacts.
import { readFile, stat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { site, digest } from "./lib/wasmbench.mjs";
import { atomicJSON } from "./lib/benchmark-plan.mjs";
import { runCommand } from "./lib/benchmark-process.mjs";
import { verifySiteExportContract } from "./lib/site-export-contract.mjs";
const directory = resolve(process.argv[2]),
  plan = JSON.parse(await readFile(join(directory, "plan.json"))),
  host = JSON.parse(await readFile(join(directory, "host.json")));
const ready = join(directory, "ready.json"),
  env = {
    ...process.env,
    NODE_OPTIONS: "",
    WASMBENCH_SKIP_HARNESS_PATCH: "1",
    WASMBENCH_ROOT: host.harness,
    WASMBENCH_RUNTIMES: plan.engines.join(","),
    WASMBENCH_WAGO_REVISION: plan.wagoRevision || "",
    WAGO_SOURCE: host.wago || "",
    WASMBENCH_V8_COMPILER_MODE: plan.collection.v8CompilerMode,
    GOWORK: "off",
    GOFLAGS: "-buildvcs=false",
  };
try {
  const receipt = JSON.parse(await readFile(ready));
  if (receipt.plan !== plan.identity)
    throw Error("Prepared host has a different plan");
  for (const file of receipt.files)
    if (digest(await readFile(file.path)) !== file.sha256)
      throw Error("Prepared tool changed: " + file.path);
  if (plan.publication?.type === "api-v1")
    await verifySiteExportContract(host.controller, { cwd: host.harness, env });
  console.log("Reusing verified host tools");
  process.exit(0);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await mkdir(directory, { recursive: true });
const buildController = () => runCommand(
  "go",
  ["build", "-trimpath", "-o", host.controller, "./cmd/wasmbench"],
  { cwd: host.harness, env, quiet: false, log: join(directory, "setup.log") },
);
if (plan.publication?.type === "api-v1") {
  await buildController();
  await verifySiteExportContract(host.controller, { cwd: host.harness, env });
}
if (plan.engines.includes("wasmer-singlepass"))
  await runCommand(process.execPath, [join(site, "scripts/wasmer-sdk.mjs")], {
    cwd: site,
    env,
    quiet: false,
    log: join(directory, "setup.log"),
  });
await runCommand(process.execPath, [join(site, "scripts/bench.mjs"), "build"], {
  cwd: site,
  env,
  quiet: false,
  log: join(directory, "setup.log"),
});
if (plan.publication?.type !== "api-v1") await buildController();
const { readdir } = await import("node:fs/promises");
const files = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await walk(path);
    else if (item.isFile() || item.isSymbolicLink())
      files.push({ path, sha256: digest(await readFile(path)) });
  }
}
if (await stat(join(host.harness, "bin")).catch(() => false))
  await walk(join(host.harness, "bin"));
await walk(join(host.harness, "adapters/v8"));
await walk(join(site, "scripts"));
const analyzer = join(
  host.harness,
  "adapters/wasmtime/target/release/wasm-analyze",
);
for (const path of [
  join(host.harness, "adapters/wasmtime/target/release/adapter-wasmtime"),
  ...plan.engines
    .filter((e) => ["wasmer-singlepass", "wavm"].includes(e))
    .map((e) =>
      join(host.harness, "adapters/native/target", e, "release/adapter-native"),
    ),
  process.execPath,
])
  if (await stat(path).catch(() => false))
    files.push({ path, sha256: digest(await readFile(path)) });
files.push({ path: analyzer, sha256: digest(await readFile(analyzer)) });
files.push({
  path: host.controller,
  sha256: digest(await readFile(host.controller)),
});
await atomicJSON(ready, {
  schema: 1,
  plan: plan.identity,
  node: process.versions,
  files,
});
