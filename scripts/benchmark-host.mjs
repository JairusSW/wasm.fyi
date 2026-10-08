// Resumable host supervisor. Each lane finishes one whole corpus before reuse.
import { availableParallelism, platform, cpus as physicalCPUs, totalmem, release, arch } from "node:os";
import { readFile, mkdir, rm, stat, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { site } from "./lib/wasmbench.mjs";
import { atomicJSON, workerCount } from "./lib/benchmark-plan.mjs";
import { runCommand } from "./lib/benchmark-process.mjs";
const directory = resolve(process.argv[2]),
  plan = JSON.parse(await readFile(join(directory, "plan.json"))),
  host = JSON.parse(await readFile(join(directory, "host.json")));
host.platform={os:platform(),arch:arch()==='x64'?'amd64':arch(),cpu:physicalCPUs()[0]?.model||'unknown',cores:physicalCPUs().length,kernel:release(),memoryBytes:totalmem()};
await mkdir(join(directory, "jobs"), { recursive: true });
const statePath = join(directory, "state.json"),
  prior = await readFile(statePath, "utf8").then(JSON.parse, (e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
if (prior?.status === "running" && prior.pid !== process.pid) {
  const probe = await runCommand(
    "ps",
    ["-p", String(prior.pid), "-o", "command="],
    { check: false },
  );
  if (
    probe.code === 0 &&
    probe.output.includes("benchmark-host.mjs") &&
    probe.output.includes(directory)
  )
    throw Error(`Host session already running as PID ${prior.pid}`);
}
const abort = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => abort.abort());
const workers = workerCount(host.workers, availableParallelism());
let cpus = [];
if (platform() === "linux") {
  const status = await readFile("/proc/self/status", "utf8");
  const list = status.match(/^Cpus_allowed_list:\s*(.*)$/m)?.[1];
  if (!list) throw Error("Cannot determine admitted CPUs");
  for (const range of list.split(",")) {
    const [lo, hi] = range.split("-").map(Number);
    for (let i = lo; i <= (hi ?? lo); i++) cpus.push(i);
  }
}
const state = {
  schema: 1,
  id: plan.id,
  machine: host.name,
  pid: process.pid,
  status: "running",
  workers,
  availableCores: availableParallelism(),
  started: prior?.started || new Date().toISOString(),
  updated: new Date().toISOString(),
  jobs: prior?.jobs || {},
};
await atomicJSON(statePath, state);
await rm(join(directory, "bundle.lock"), { force: true });
const emit = (event) =>
  console.log(
    JSON.stringify({
      benchmarkEvent: true,
      machine: host.name,
      time: new Date().toISOString(),
      ...event,
    }),
  );
let saving = Promise.resolve();
const save = () => {
  state.updated = new Date().toISOString();
  saving = saving.then(() => atomicJSON(statePath, state));
  return saving;
};
let next = 0;
const queue = [];
for (const job of plan.jobs) {
  const completed = await readFile(
    join(directory, "jobs", job.id, "result.json"),
    "utf8",
  ).then(JSON.parse, (e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
  if (completed) {
    if (completed.plan !== plan.identity)
      throw Error("Saved corpus plan changed");
    state.jobs[job.id] = { status: "completed", result: completed };
    emit({
      corpus: job.id,
      status: "completed",
      result: completed,
      resumed: true,
    });
  } else queue.push(job);
}
emit({
  status: "host-ready",
  workers,
  cores: state.availableCores,
  remaining: queue.length,
});
await Promise.all(
  Array.from({ length: Math.min(workers, queue.length) }, (_, lane) =>
    (async () => {
      while (next < queue.length && !abort.signal.aborted) {
        const job = queue[next++],
          dir = join(directory, "jobs", job.id);
        await mkdir(dir, { recursive: true });
        // An incomplete attempt is restarted for this corpus only. Cached Wasm stays.
        await rm(join(dir, "corpus-0001"), { recursive: true, force: true });
        await atomicJSON(join(directory, "host-lane-" + lane + ".json"), {
          ...host,
          cpu: cpus[lane],
        });
        state.jobs[job.id] = {
          status: "running",
          lane,
          started: new Date().toISOString(),
        };
        await save();
        const jobHost = join(dir, "host.json");
        await atomicJSON(jobHost, { ...host, cpu: cpus[lane] });
        try {
          await runCommand(
            process.execPath,
            [
              join(site, "scripts/benchmark-worker.mjs"),
              directory,
              job.id,
              jobHost,
            ],
            {
              cwd: site,
              signal: abort.signal,
              log: join(dir, "worker.log"),
              env: { ...process.env, BENCHMARK_JOB_HOST: jobHost },
              onLine: (line) => {
                try {
                  const event = JSON.parse(line);
                  if (event.benchmarkEvent) {
                    emit(event);
                    if (event.status === "completed")
                      state.jobs[job.id] = {
                        status: "completed",
                        result: event.result,
                      };
                  }
                } catch {}
              },
            },
          );
        } catch (error) {
          state.jobs[job.id] = {
            status: abort.signal.aborted ? "paused" : "error",
            reason: error.message,
          };
          emit({ corpus: job.id, ...state.jobs[job.id] });
        }
        await save();
      }
    })(),
  ),
);
await saving;
state.status = abort.signal.aborted
  ? "paused"
  : Object.values(state.jobs).some((j) => j.status === "error")
    ? "incomplete"
    : Object.values(state.jobs).some((j) => j.result?.verdict === "FAIL")
      ? "completed-with-failures"
      : "completed";
await save();
emit({
  status: state.status,
  completed: Object.values(state.jobs).filter((j) => j.status === "completed")
    .length,
  total: plan.jobs.length,
});
if (state.status === "incomplete") process.exitCode = 1;
if (abort.signal.aborted) process.exitCode = 130;
