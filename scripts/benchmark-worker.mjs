// One isolated worker owns one artifact and every measurement phase for it.
import {
  readFile,
  writeFile,
  mkdir,
  cp,
  rm,
  open,
  readdir,
  stat,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { site, digest } from "./lib/wasmbench.mjs";
import {
  atomicJSON,
  restoreWorkloads,
  verifyWorkloads,
} from "./lib/benchmark-plan.mjs";
import { collectCorpusByCorpus } from "./lib/corpus-collection.mjs";
import { runCommand } from "./lib/benchmark-process.mjs";
const [directory, key] = process.argv.slice(2);
if (!directory || !/^corpus-\d+$/.test(key))
  throw Error("Internal worker requires a session directory and corpus ID");
const root = resolve(directory),
  plan = JSON.parse(await readFile(join(root, "plan.json"))),
  host = JSON.parse(
    await readFile(process.env.BENCHMARK_JOB_HOST || join(root, "host.json")),
  ),
  job = plan.jobs.find((j) => j.id === key);
if (!job) throw Error("Unknown corpus job");
const dir = join(root, "jobs", key);
await mkdir(join(dir, ".wasmbench"), { recursive: true });
const abort = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => abort.abort());
const emit = (event) =>
  console.log(
    JSON.stringify({
      benchmarkEvent: true,
      machine: host.name,
      corpus: key,
      time: new Date().toISOString(),
      ...event,
    }),
  );
const workloads = restoreWorkloads(site, job.workloads);
await verifyWorkloads(workloads);
const suite = join(dir, "wago-suite.json");
await atomicJSON(suite, workloads);
const env = {
  ...process.env,
  GOWORK: "off",
  GOFLAGS: "-buildvcs=false",
  GOMAXPROCS: "1",
  RAYON_NUM_THREADS: "1",
  OMP_NUM_THREADS: "1",
  NODE_OPTIONS: "",
  WASMBENCH_RECORD_FAILURES: "1",
};
process.env.WASMBENCH_RECORD_FAILURES = "1";
process.env.WASMBENCH_VALIDATION_PROFILE = plan.collection.validationProfile;
delete process.env.WASMBENCH_SCENARIO_SAMPLES;
delete process.env.WASMBENCH_TIMING_ONLY;
if (plan.wagoRevision) process.env.WASMBENCH_WAGO_REVISION = plan.wagoRevision;
// On Linux, pin the controller and all descendants to one admitted CPU per lane.
const invoke = async (command, ...args) => {
  emit({
    phase: command === "run" ? args[args.indexOf("--profile") + 1] : command,
    status: "running",
  });
  const commandArgs =
    host.cpu != null
      ? ["--cpu-list", String(host.cpu), host.controller, command, ...args]
      : [command, ...args];
  await runCommand(
    host.cpu != null ? "taskset" : host.controller,
    commandArgs,
    {
      cwd: host.harness,
      env,
      signal: abort.signal,
      log: join(dir, "commands.log"),
    },
  );
  return "";
};
async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const b of createReadStream(path)) hash.update(b);
  return hash.digest("hex");
}
async function retainBundle({ bundle, profile }) {
  if (profile !== "timing") return;
  const manifest = JSON.parse(await readFile(join(bundle, "manifest.json")));
  const main = join(root, "bundle");
  const checkIdentity = async () => {
    const metadata = JSON.parse(await readFile(join(main, "metadata.json")));
    if (
      metadata.planSha256 !== plan.identity ||
      JSON.stringify(metadata.runtimes) !==
        JSON.stringify(manifest.lock.runtime_configurations)
    )
      throw Error("Runtime tools/configuration changed within this session");
  };
  await mkdir(main, { recursive: true });
  let lock;
  try {
    lock = await open(join(root, "bundle.lock"), "wx");
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    while (true) {
      if (abort.signal.aborted) throw Error("Interrupted");
      try {
        await stat(join(main, "index.json"));
        await checkIdentity();
        return;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      try {
        await stat(join(root, "bundle.lock"));
      } catch (e) {
        if (e.code === "ENOENT") return retainBundle({ bundle, profile });
        throw e;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    try {
      await stat(join(main, "index.json"));
      await checkIdentity();
      return;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    for (const file of await readdir(main))
      await rm(join(main, file), { recursive: true, force: true });
    await cp(join(bundle, "tools"), join(main, "tools"), { recursive: true });
    await atomicJSON(join(main, "metadata.json"), {
      schema: 1,
      id: plan.id,
      planSha256: plan.identity,
      host: manifest.host,
      runner: {
        version: manifest.lock.runner_version,
        sha256: manifest.lock.runner_sha256,
      },
      analyzer: manifest.lock.analyzer,
      runtimes: manifest.lock.runtime_configurations,
      options: plan.collection,
      workerPolicy: {
        goThreads: 1,
        rayonThreads: 1,
        openmpThreads: 1,
        nodeOptions: env.NODE_OPTIONS,
        workers: host.workers,
        cpuAffinity:
          host.cpu != null
            ? "one admitted Linux CPU per lane"
            : "concurrency limit; no CPU affinity",
      },
      workloads: plan.jobs.flatMap((j) =>
        j.workloads.map((w) => ({ id: w.id, sha256: w.sha256 })),
      ),
      scope:
        "Exact archived runner, analyzer and adapters; unlisted system/native-library dependencies remain hash-verified host prerequisites. Corpus reports are transferred individually.",
    });
    const archive = join(root, "bundle.tar.gz");
    await runCommand("tar", ["-czf", archive, "-C", main, "."], {
      signal: abort.signal,
      log: join(dir, "commands.log"),
    });
    const bytes = (await stat(archive)).size,
      sha256 = await hashFile(archive);
    const parts = [];
    let index = 0;
    // Keep each published file below GitHub's single-file size limit.
    for await (const chunk of createReadStream(archive, {
      highWaterMark: 32 * 1024 * 1024,
    })) {
      const name = `bundle.tar.gz.part-${String(index++).padStart(3, "0")}`;
      await writeFile(join(main, name), chunk);
      parts.push({ path: name, bytes: chunk.length, sha256: digest(chunk) });
    }
    await atomicJSON(join(main, "index.json"), {
      schema: 1,
      id: plan.id,
      machine: host.name,
      bytes,
      sha256,
      format: "tar+gzip concatenated parts",
      parts,
      metadata: "metadata.json",
      metadataSha256: digest(await readFile(join(main, "metadata.json"))),
      download:
        "Concatenate parts in order, verify the full SHA-256, then tar -xzf bundle.tar.gz.",
    });
    await rm(archive);
    await rm(join(main, "tools"), { recursive: true, force: true });
  } finally {
    await lock.close();
    await rm(join(root, "bundle.lock"), { force: true });
  }
}
try {
  const collection = { ...plan.collection };
  collection.siteExportV2 = plan.publication?.type === "api-v1";
  const reports = await collectCorpusByCorpus({
    directory: dir,
    suite,
    runtimes: plan.engines.join(","),
    collection,
    run: invoke,
    number: (_name, value) => value,
    site: dir,
    onBundle: retainBundle,
  });
  const rows = [],
    memory = [],
    code = [];
  for (const report of reports) {
    const data = JSON.parse(await readFile(join(report, "data.json")));
    for (const summary of data.summaries || []) rows.push(summary);
    memory.push(...(data.memory_stages || []));
    code.push(...(data.code_records || []));
    const receiptPath = join(report, "wasm-fyi-export.json"),
      receipt = JSON.parse(await readFile(receiptPath));
    receipt.collectionBundle = {
      id: plan.id,
      machine: host.name,
      url: `/wasmbench/runs/${plan.id}/${host.name}/bundle/index.json`,
    };
    const bytes = Buffer.from(JSON.stringify(receipt) + "\n");
    await writeFile(receiptPath, bytes);
    const checks = JSON.parse(await readFile(join(report, "checksums.json")));
    checks["wasm-fyi-export.json"] = digest(bytes);
    await atomicJSON(join(report, "checksums.json"), checks);
  }
  const measured = rows.filter((r) => r.scenario === "steady");
  const result = {
    schema: 1,
    corpus: key,
    workloads: workloads.map((w) => w.id),
    reports: reports.map((p) => p.slice(root.length + 1)),
    ...(collection.siteExportV2 ? {siteExports: reports.map(p=>join(dirname(p),'site-v2').slice(root.length+1))} : {}),
    plan: plan.identity,
    summaries: rows,
    memory,
    code,
    verdict: rows.some((r) =>
      Object.entries(r.outcomes || {}).some(
        ([s, n]) => n > 0 && !["ok", "unsupported"].includes(s),
      ),
    )
      ? "FAIL"
      : measured.length &&
          measured.every((r) => r.median_ns_per_operation != null)
        ? "PASS"
        : measured.length
          ? "UNSUPPORTED"
          : "NOT MEASURED",
    finished: new Date().toISOString(),
  };
  await atomicJSON(join(dir, "result.json"), result);
  emit({ status: "completed", result });
} catch (error) {
  await atomicJSON(join(dir, "error.json"), {
    message: error.message,
    time: new Date().toISOString(),
    interrupted: abort.signal.aborted,
  });
  emit({
    status: abort.signal.aborted ? "paused" : "error",
    reason: error.message,
  });
  process.exitCode = abort.signal.aborted ? 130 : 1;
}
