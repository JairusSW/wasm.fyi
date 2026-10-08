// One isolated worker owns one artifact and every measurement phase for it.
import {
  readFile,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { site, digest } from "./lib/wasmbench.mjs";
import {
  atomicJSON,
  restoreWorkloads,
  verifyWorkloads,
} from "./lib/benchmark-plan.mjs";
import { collectCorpusByCorpus } from "./lib/corpus-collection.mjs";
import { runCommand } from "./lib/benchmark-process.mjs";
import { retainCollectionParent } from "./lib/benchmark-parent-bundle.mjs";
import {collectLatencies} from './lib/latency-capture.mjs';
import { collectionVerdict } from "./lib/collection-verdict.mjs";
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
      ...(plan.collection.capture!=="latency"?{log: join(dir, "commands.log")}:{}),
    },
  );
  return "";
};
const retainBundle = (event) => retainCollectionParent({
  ...event, root, log: join(dir, "commands.log"), plan, host, env, signal: abort.signal,
});
try {
  const collection = { ...plan.collection };
  collection.siteExportV2 = plan.publication?.type === "api-v1";
  if(collection.capture==='latency') {
    const latency=await collectLatencies({directory:dir,workloads,engines:plan.engines,collection,run:invoke,platform:host.platform,onTiming:({runnerMs,captureMs})=>emit({status:"running",step:`runtime passes ${Math.round(runnerMs)} ms; capture ${Math.round(captureMs)} ms`})});
    const summaries=latency.results.map(r=>({runtime:r.engine,workload:r.workload,scenario:r.phase,median_ns_per_operation:r.latencyNs,outcomes:{[r.latencyStatus==='not-measured'||r.latencyStatus==='disabled'?'unsupported':r.latencyStatus]:1}}));
    const result={schema:1,corpus:key,workloads:workloads.map(w=>w.id),plan:plan.identity,latency,summaries,verdict:collectionVerdict(summaries,collection.scenarios?.split(',')||['steady']),finished:latency.capturedAt};
    await atomicJSON(join(dir,'result.json'),result);
    await rm(suite,{force:true});
    emit({status:'completed',result});
  } else {
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
  const verdictScenarios = plan.collection.scenarios?.split(",") || ["steady"];
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
    verdict: collectionVerdict(rows, verdictScenarios),
    finished: new Date().toISOString(),
  };
  await atomicJSON(join(dir, "result.json"), result);
  emit({ status: "completed", result });
  }
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
