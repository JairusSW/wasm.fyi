#!/usr/bin/env node
import {
  readFile,
  writeFile,
  mkdir,
  cp,
  rm,
  readdir,
  stat,
  symlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { site, config, digest, command } from "./lib/wasmbench.mjs";
import {
  atomicJSON,
  cacheDirectory,
  existingWorkloads,
  cacheWorkloads,
  readCache,
  selectWorkloads,
  verifyWorkloads,
  portableWorkloads,
  planIdentity,
  machineWorkers,
  workerCount,
} from "./lib/benchmark-plan.mjs";
import { corpusGroups } from "./lib/corpus-collection.mjs";
import { runCommand, quote } from "./lib/benchmark-process.mjs";
import { publishCorpus } from "./lib/benchmark-publish.mjs";
import { benchmarkSource, sourceBundle } from "./lib/benchmark-source.mjs";
import { verifyParentBundle } from "./lib/benchmark-bundle.mjs";
import { verifySeal } from "./lib/verify-seal.mjs";
import { releaseSource } from "./lib/release-policy.mjs";
try {
  const help = `Usage: just benchmark [options]
  --corpus qoi,applications/image-blur (repeatable; exact IDs or family prefixes)
  --kind non-feature|features|both       default: non-feature
  --engines wago,wazero,v8               default: all six supported engines
  --machines local,hub,user@host         SSH aliases also read hosts in config
  --workers 25%                         default: quarter of admitted cores
  --workers local=25%,hub=50%            per-machine percentages or counts
  --id NAME --launches N --samples N --timeout 5m
  --no-live                             retain reports without changing site
  --deploy                              commit results, push branch, deploy Pages
just benchmark-resume ID                 same immutable plan; completed corpora skipped
just benchmark-status [ID]               durable progress and outcomes
just benchmark-stop ID                  stop local and SSH host supervisors
just corpus-cache [--corpus ... --kind both]    adopt built artifacts without compilation
just corpus-build [--corpus ... --kind both]    explicit source build + hashed cache
`;
  const [action = "run", ...args] = process.argv.slice(2);
  if (args.includes("--help") || action === "help" || action === "--help") {
    console.log(help);
    process.exit(0);
  }
  const options = { corpus: [] };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, equal] = arg.slice(2).split(/=(.*)/s);
    if (["no-live", "deploy"].includes(key)) {
      options[key] = true;
      continue;
    }
    if (
      ![
        "corpus",
        "kind",
        "engines",
        "machines",
        "workers",
        "id",
        "launches",
        "samples",
        "timeout",
      ].includes(key)
    )
      throw Error("Unknown option: " + arg);
    const value = equal ?? args[++i];
    if (!value || value.startsWith("--")) throw Error("Missing value: " + arg);
    if (key === "corpus") options.corpus.push(...value.split(","));
    else options[key] = value;
  }
  const settings = await config(),
    runs = join(site, ".wasmbench/benchmark-runs");
  await mkdir(runs, { recursive: true });
  const validID = (id) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(id || ""))
      throw Error("Invalid run ID");
    return id;
  };
  const directories = async (path) =>
    (await readdir(path, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  const readJSON = (path) => readFile(path, "utf8").then(JSON.parse);
  const sshOptions = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
  ];
  const ssh = async (host, script, opts = {}) =>
    runCommand(
      "ssh",
      [...sshOptions, host.ssh, "bash -lc " + quote(script)],
      opts,
    );
  const transfer = async (host, from, to, upload = false) =>
    runCommand("rsync", [
      "-a",
      "-e",
      ["ssh", ...sshOptions.map(quote)].join(" "),
      ...(upload
        ? [from, host.ssh + ":" + quote(to)]
        : [host.ssh + ":" + quote(from), to]),
    ]);
  const stopCode = (path) =>
    `const fs=require('fs');const path=${JSON.stringify(path)};if(fs.existsSync(path)){const s=JSON.parse(fs.readFileSync(path));if(s.status==='running'){try{process.kill(s.pid,0);const cmd=require('child_process').execFileSync('ps',['-p',String(s.pid),'-o','command=']).toString();if(!cmd.includes('benchmark-host.mjs')||!cmd.includes(${JSON.stringify(path.replace(/\/state.json$/, ""))}))throw Error('PID does not own this session');process.kill(s.pid,'SIGTERM');console.log('Stopped '+s.machine);}catch(e){if(e.code!=='ESRCH')throw e;}}}}`;
  const killScript = (path) => `node -e ${quote(stopCode(path))};`;
  async function stop(directory) {
    const coordinator = await readJSON(
      join(directory, "coordinator.json"),
    ).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (coordinator?.status === "running") {
      try {
        const cmd = command("ps", [
          "-p",
          String(coordinator.pid),
          "-o",
          "command=",
        ]).toString();
        if (cmd.includes("scripts/benchmark.mjs"))
          process.kill(coordinator.pid, "SIGTERM");
      } catch {}
    }
    const hosts = await directories(join(directory, "hosts")).catch(() => []);
    for (const name of hosts) {
      const local = join(directory, "hosts", name),
        host = await readJSON(join(local, "host.json"));
      if (host.ssh)
        await ssh(
          host,
          host.prefix + killScript(join(host.remote, "session/state.json")),
          { quiet: false },
        );
      else
        await runCommand(
          process.execPath,
          ["-e", stopCode(join(local, "state.json"))],
          { check: false },
        ).catch(() => {});
    }
  }
  if (action === "status") {
    const ids = positional.length
      ? [validID(positional[0])]
      : await directories(runs);
    for (const id of ids) {
      const path = join(runs, id);
      console.log("\n" + id);
      const plan = await readJSON(join(path, "plan.json"));
      console.log(`${plan.jobs.length} corpora · ${plan.engines.join(", ")}`);
      for (const name of await directories(join(path, "hosts")).catch(
        () => [],
      )) {
        const root = join(path, "hosts", name),
          host = await readJSON(join(root, "host.json"));
        const state = host.ssh
          ? JSON.parse(
              (
                await ssh(
                  host,
                  `cat ${quote(join(host.remote, "session/state.json"))}`,
                  { check: false },
                )
              ).output || "null",
            )
          : await readJSON(join(root, "state.json")).catch(() => null);
        console.log(
          `${name}: ${state?.status || "preparing"} · ${Object.values(state?.jobs || {}).filter((j) => j.status === "completed").length}/${plan.jobs.length}`,
        );
      }
    }
    process.exit(0);
  }
  if (action === "stop") {
    await stop(join(runs, validID(positional[0])));
    process.exit(0);
  }
  if (action === "cache" || action === "build-corpus") {
    let builtUpstream = [];
    if (action === "build-corpus") {
      const built = await existingWorkloads(site, settings);
      const contracts = JSON.parse(
        await readFile(join(site, "corpora/upstream/contracts.json")),
      );
      const inventory = new Map(
        [
          ...built,
          ...contracts,
          { id: "mechanisms/host-to-wasm-call" },
          { id: "mechanisms/wasm-to-host-call" },
        ].map((w) => [w.id, w]),
      );
      const selected = selectWorkloads([...inventory.values()], {
        kind: options.kind || "both",
        corpus: options.corpus,
      });
      const upstream = [
        ...new Set(
          selected
            .filter((w) => w.id.startsWith("wago/"))
            .map((w) => w.id.split("/")[1]),
        ),
      ];
      if (upstream.length) {
        await runCommand(
          process.execPath,
          [join(site, "scripts/wasi-sdk-toolchain.mjs")],
          { cwd: site, quiet: false },
        );
        await runCommand(
          process.execPath,
          [
            join(site, "scripts/corpus-rebuild.mjs"),
            "--ids=" + upstream.join(","),
          ],
          { cwd: site, quiet: false },
        );
        const pointer = await readJSON(
          join(site, ".wasmbench/latest-source-build.json"),
        );
        builtUpstream = JSON.parse(
          await readFile(join(pointer.directory, "suite.json")),
        );
        await cacheWorkloads(site, builtUpstream);
      }
      const applications = selected
        .filter((w) => w.id.startsWith("applications/"))
        .map((w) => w.id.split("/")[1]);
      if (applications.length)
        await runCommand(
          process.execPath,
          [
            join(site, "scripts/application-corpus.mjs"),
            "build",
            "--ids=" + applications.join(","),
          ],
          { cwd: site, quiet: false },
        );
      const features = [
        ...new Set(
          selected
            .filter((w) => w.id.startsWith("features/"))
            .map((w) => w.id.split("/").slice(0, 3).join("/")),
        ),
      ];
      if (features.length)
        await runCommand(
          process.execPath,
          [
            join(site, "scripts/feature-corpus.mjs"),
            "build",
            "--ids=" + features.join(","),
          ],
          { cwd: site, quiet: false },
        );
      if (
        !options.corpus.length ||
        options.corpus.some((s) => s === "mechanisms" || s.includes("host"))
      ) {
        process.env.WASMBENCH_ROOT = await benchmarkSource(settings);
        const { run } = await (await import("./lib/wasmbench.mjs")).harness();
        await mkdir(cacheDirectory(site), { recursive: true });
        process.stdout.write(
          run(
            "corpus",
            "--suite",
            "calls",
            "--out",
            join(cacheDirectory(site), "calls.json"),
          ),
        );
      }
    }
    const existing = await existingWorkloads(site, settings),
      builtIDs = new Set(builtUpstream.map((w) => w.id)),
      all = [...existing.filter((w) => !builtIDs.has(w.id)), ...builtUpstream],
      selected = selectWorkloads(all, {
        kind: options.kind || "both",
        corpus: options.corpus,
      });
    await cacheWorkloads(site, selected);
    console.log(
      `Cached ${selected.length} hash-verified contracts at ${cacheDirectory(site)}; Wasm remains until explicitly rebuilt.`,
    );
    process.exit(0);
  }
  if (!["run", "resume"].includes(action)) throw Error(help);
  const abort = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => abort.abort());
  const id = validID(
      action === "resume"
        ? positional[0]
        : options.id ||
            new Date().toISOString().replace(/[:.]/g, "-") +
              "-" +
              randomUUID().slice(0, 8),
    ),
    directory = join(runs, id);
  let plan;
  if (action === "resume") {
    if (
      Object.keys(options).some((k) => k !== "corpus") ||
      options.corpus.length
    )
      throw Error(
        "Resume takes only an ID; its selection and recipe are immutable. Start a new run to change them.",
      );
    plan = await readJSON(join(directory, "plan.json"));
    if (planIdentity(plan) !== plan.identity)
      throw Error("Saved plan digest mismatch");
    await verifyWorkloads(
      (await import("./lib/benchmark-plan.mjs")).restoreWorkloads(
        site,
        plan.jobs.flatMap((j) => j.workloads),
      ),
    );
  } else {
    try {
      await stat(directory);
      throw Error("Run ID already exists; use benchmark-resume");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (
      !(await stat(join(cacheDirectory(site), "manifest.json")).catch(
        () => false,
      ))
    ) {
      const available = selectWorkloads(
        await existingWorkloads(site, settings),
        { kind: options.kind, corpus: options.corpus },
      );
      await cacheWorkloads(site, available);
      console.log(
        `Adopted ${available.length} existing Wasm contracts; no compilation.`,
      );
    }
    const workloads = selectWorkloads(await readCache(site), {
      kind: options.kind,
      corpus: options.corpus,
    });
    if (!workloads.length) throw Error("Empty corpus selection");
    await verifyWorkloads(workloads);
    const engines = (
      options.engines || settings.collection.runtimes.join(",")
    ).split(",");
    if (
      !engines.length ||
      new Set(engines).size !== engines.length ||
      engines.some((e) => !settings.collection.runtimes.includes(e))
    )
      throw Error(
        "Supported engines: " + settings.collection.runtimes.join(","),
      );
    const machines = (options.machines || "local").split(",").map((name) => {
      if (name === "local")
        return {
          name,
          workers: machineWorkers(options.workers || "25%", name),
        };
      const record = settings.hosts?.[name] || {
        ssh: name,
        workspace: ".cache/wasm-fyi",
      };
      if (
        !/^[A-Za-z0-9][A-Za-z0-9_.@-]*$/.test(record.ssh) ||
        !/^\.?[A-Za-z0-9_./-]+$/.test(record.workspace) ||
        record.workspace.includes("..") ||
        record.workspace.startsWith("/")
      )
        throw Error("Invalid SSH machine/workspace");
      return {
        name: name.replaceAll("@", "-"),
        ssh: record.ssh,
        workspace: record.workspace,
        workers: machineWorkers(options.workers || "25%", name),
      };
    });
    if (new Set(machines.map((m) => m.name)).size !== machines.length)
      throw Error("Duplicate machine");
    for (const m of machines) workerCount(m.workers, 1000000);
    const collection = { ...settings.collection };
    for (const key of ["launches", "samples"])
      if (options[key]) {
        if (!/^[1-9]\d*$/.test(options[key])) throw Error("Invalid " + key);
        collection[key] = Number(options[key]);
        if (key === "samples")
          collection.scenarioSamples = { "*": Number(options[key]) };
      }
    if (options.timeout) {
      if (!/^\d+(?:ms|s|m|h)$/.test(options.timeout))
        throw Error("Invalid timeout");
      collection.timeout = options.timeout;
    }
    const harnessRoot = await benchmarkSource(settings),
      harnessRevision = command("git", ["rev-parse", "HEAD"], {
        cwd: harnessRoot,
      })
        .toString()
        .trim();
    let wago;
    if (engines.includes("wago"))
      wago = await releaseSource("wago-org/wago", {
        tag: settings.collection.wagoRelease.tag,
        betaPrerelease: true,
      });
    plan = {
      schema: 1,
      id,
      created: new Date().toISOString(),
      engines,
      machines,
      collection,
      live: !options["no-live"],
      deploy: !!options.deploy,
      harnessRevision,
      harnessRoot,
      wagoRevision: wago
        ? command("git", ["rev-parse", "HEAD"], { cwd: wago.source })
            .toString()
            .trim()
        : null,
      wagoSource: wago?.source,
      node: settings.node,
      jobs: corpusGroups(portableWorkloads(site, workloads)).map((ws, i) => ({
        id: "corpus-" + String(i + 1).padStart(4, "0"),
        workloads: ws,
      })),
    };
    if (plan.deploy && !plan.live)
      throw Error("--no-live cannot be combined with --deploy");
    plan.identity = planIdentity(plan);
    await atomicJSON(join(directory, "plan.json"), plan);
  }
  const coordinatorPath = join(directory, "coordinator.json"),
    prior = await readJSON(coordinatorPath).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
  if (prior?.status === "running") {
    try {
      process.kill(prior.pid, 0);
      throw Error("Coordinator already running: " + prior.pid);
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  }
  await atomicJSON(coordinatorPath, {
    pid: process.pid,
    status: "running",
    id,
    started: new Date().toISOString(),
  });
  console.log(
    `Run ${id}\n${plan.jobs.length} corpora · ${plan.engines.join(", ")} · ${plan.machines.map((m) => m.name + " " + m.workers).join(", ")}\nResume: just benchmark-resume ${id}\nStop: just benchmark-stop ${id}`,
  );
  let uploading = Promise.resolve(),
    uploadError,
    failed = false;
  const human = (event) => {
    if (event.corpus) {
      const names =
        plan.jobs
          .find((j) => j.id === event.corpus)
          ?.workloads.map((w) => w.id)
          .join(", ") || event.corpus;
      console.log(
        `[${event.machine} ${event.corpus}] ${names}: ${event.result?.verdict || event.phase || event.status}`,
      );
      if (event.result) {
        for (const runtime of plan.engines) {
          const rows = event.result.summaries.filter(
              (r) => r.runtime === runtime,
            ),
            metric = (scenario) => {
              const r = rows.findLast(
                (r) =>
                  r.scenario === scenario && r.median_ns_per_operation != null,
              );
              return r
                ? r.median_ns_per_operation < 1000
                  ? `${r.median_ns_per_operation.toFixed(2)} ns`
                  : `${(r.median_ns_per_operation / 1000).toFixed(3)} µs`
                : "unavailable";
            };
          const rssRows =
              event.result.memory?.filter(
                (r) =>
                  r.runtime === runtime &&
                  r.metric === "process.rss" &&
                  r.median_bytes != null,
              ) || [],
            rss = rssRows.length
              ? Math.round(
                  rssRows.reduce((n, r) => n + r.median_bytes, 0) /
                    rssRows.length,
                )
              : null,
            code = event.result.code?.find((r) => r.runtime === runtime);
          console.log(
            `  ${runtime}: compile ${metric("compile")} · instantiate ${metric("instantiate")} · steady ${metric("steady")} · average process RSS ${rss ?? "unavailable"} B · code ${code?.image_bytes ?? code?.size_bytes ?? "unavailable"} B`,
          );
        }
      }
    } else
      console.log(
        `[${event.machine}] ${event.status}${event.workers ? " · " + event.workers + "/" + event.cores + " workers/cores" : ""}`,
      );
  };
  async function publish(host, event) {
    const local = join(directory, "hosts", host.name),
      job = join(local, "jobs", event.corpus);
    if (host.ssh) {
      await mkdir(job, { recursive: true });
      await transfer(
        host,
        join(host.remote, "session/jobs", event.corpus) + "/",
        job + "/",
      );
      if (!(await stat(join(local, "bundle/index.json")).catch(() => false))) {
        await mkdir(join(local, "bundle"), { recursive: true });
        await transfer(
          host,
          join(host.remote, "session/bundle") + "/",
          join(local, "bundle") + "/",
        );
      }
    }
    const result = await readJSON(join(job, "result.json"));
    if (result.plan !== plan.identity)
      throw Error("Received result with wrong plan");
    const paths = result.reports.map((p) => {
      if (
        p.includes("..") ||
        !p.startsWith("jobs/" + event.corpus + "/exports/")
      )
        throw Error("Unsafe report path");
      return join(local, p);
    });
    await verifyParentBundle(join(local, "bundle"), plan);
    for (const path of paths) await verifySeal(path);
    const marker = join(job, "published.json");
    if (await stat(marker).catch(() => false)) return;
    if (plan.live) {
      const target = join(site, "data/benchmark-runs", id, host.name);
      await mkdir(target, { recursive: true });
      await cp(join(local, "bundle"), join(target, "bundle"), {
        recursive: true,
      });
      await atomicJSON(join(target, event.corpus + ".json"), {
        ...result,
        reports: undefined,
        summaries: undefined,
        memory: undefined,
        code: undefined,
      });
      await publishCorpus(paths);
      console.log(`[${host.name} ${event.corpus}] website updated`);
    }
    await atomicJSON(marker, {
      published: new Date().toISOString(),
      live: plan.live,
    });
  }
  async function setup(machine) {
    const local = join(directory, "hosts", machine.name);
    await mkdir(local, { recursive: true });
    const existing = await readJSON(join(local, "host.json")).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (existing) return existing;
    const host = { ...machine };
    if (!host.ssh) {
      host.site = join(local, "site");
      await rm(host.site, { recursive: true, force: true });
      host.harness = join(local, "harness");
      host.controller = join(local, "wasmbench");
      host.wago = plan.wagoSource;
      await rm(host.harness, { recursive: true, force: true });
      await runCommand(
        "git",
        ["clone", "--quiet", "--shared", plan.harnessRoot, host.harness],
        { signal: abort.signal },
      );
      await runCommand(
        "git",
        ["checkout", "--quiet", "--detach", plan.harnessRevision],
        { cwd: host.harness, signal: abort.signal },
      );
      const { cloneCopy } = await import("./lib/copy.mjs");
      if (
        await stat(join(plan.harnessRoot, "adapters/wasmtime/target")).catch(
          () => false,
        )
      )
        await cloneCopy(
          join(plan.harnessRoot, "adapters/wasmtime/target"),
          join(host.harness, "adapters/wasmtime/target"),
          { recursive: true },
        );
      await mkdir(join(host.site, "corpora/features"), { recursive: true });
      await mkdir(join(host.site, ".wasmbench"), { recursive: true });
      for (const name of ["scripts", "patches", "adapters"])
        await cloneCopy(join(site, name), join(host.site, name), {
          recursive: true,
        });
      await cp(
        join(site, "corpora/features/generator.mjs"),
        join(host.site, "corpora/features/generator.mjs"),
      );
      await cp(
        join(site, "wasmbench.config.json"),
        join(host.site, "wasmbench.config.json"),
      );
      await symlink(
        cacheDirectory(site),
        join(host.site, ".wasmbench/corpus-cache"),
      );
      await atomicJSON(join(local, "plan.json"), plan);
      await atomicJSON(join(local, "host.json"), host);
      return host;
    }
    const info = (
        await ssh(host, 'printf "%s\\n" "$HOME"; uname -s; uname -m')
      ).output
        .trim()
        .split("\n"),
      [home, os, arch] = info;
    if (!home.startsWith("/") || !["Linux", "Darwin"].includes(os))
      throw Error("SSH requires Linux or macOS");
    const triplet =
      (os === "Linux" ? "linux" : "darwin") +
      "-" +
      ({ x86_64: "x64", aarch64: "arm64", arm64: "arm64" }[arch] ||
        "unsupported");
    if (triplet.includes("unsupported"))
      throw Error("Unsupported SSH architecture");
    const base = join(home, host.workspace),
      nodeDir = join(
        base,
        "toolchains",
        "node-v" + plan.node.version + "-" + triplet,
      );
    host.remote = join(base, "benchmark-runs", id);
    host.prefix = `export PATH=${quote(join(nodeDir, "bin"))}:"$HOME/.cargo/bin:$HOME/go/bin:$HOME/.local/bin:$PATH"; `;
    host.harness = join(host.remote, "harness");
    host.wago = plan.wagoRevision ? join(host.remote, "wago") : undefined;
    host.controller = join(host.remote, "session/wasmbench");
    const extension = triplet.startsWith("linux") ? ".tar.xz" : ".tar.gz",
      archive = "node-v" + plan.node.version + "-" + triplet + extension,
      sha = triplet === "linux-x64" ? plan.node.linuxX64Sha256 : null;
    await ssh(
      host,
      `set -eu; mkdir -p ${quote(base + "/toolchains")} ${quote(host.remote + "/site")} ${quote(host.remote + "/session")}; if ! test -x ${quote(nodeDir + "/bin/node")}; then task_stage=$(mktemp -d ${quote(base + "/toolchains/node-stage.XXXXXX")}); trap 'rm -rf "$task_stage"' EXIT; curl -fLsS --retry 3 ${quote("https://nodejs.org/dist/v" + plan.node.version + "/" + archive)} -o "$task_stage/${archive}"; ${sha ? `echo ${quote(sha + "  ")}"$task_stage/${archive}" | ${os === "Linux" ? "sha256sum" : "shasum -a 256"} -c -` : `curl -fLsS ${quote("https://nodejs.org/dist/v" + plan.node.version + "/SHASUMS256.txt")} -o "$task_stage/SHA"; (cd "$task_stage"; awk '$2=="${archive}"' SHA | ${os === "Linux" ? "sha256sum" : "shasum -a 256"} -c -)`}; tar -xf "$task_stage/${archive}" -C "$task_stage"; mv "$task_stage/${archive.replace(extension, "")}" ${quote(nodeDir)}; fi; ${host.prefix}test "$(node -p process.versions.node)" = ${quote(plan.node.version)}; test "$(node -p process.versions.v8)" = ${quote(plan.node.v8)}; for tool in go git rsync tar ${os === "Linux" ? "taskset" : ""}; do command -v "$tool"; done;`,
      { signal: abort.signal, quiet: false },
    );
    await ssh(
      host,
      `rm -rf ${quote(host.harness)} ${quote(host.wago || host.remote + "/unused-wago")}`,
      { signal: abort.signal },
    );
    for (const [name, source, revision] of [
      ["harness", plan.harnessRoot, plan.harnessRevision],
      ...(plan.wagoRevision
        ? [["wago", plan.wagoSource, plan.wagoRevision]]
        : []),
    ]) {
      const pack = join(local, name + ".gitbundle");
      const ref = await sourceBundle(source, revision, pack, {
        signal: abort.signal,
      });
      await transfer(host, pack, join(host.remote, name + ".gitbundle"), true);
      await ssh(
        host,
        `set -eu; mkdir -p ${quote(join(host.remote, name))}; git -C ${quote(join(host.remote, name))} init --quiet; git -C ${quote(join(host.remote, name))} fetch --quiet ${quote(join(host.remote, name + ".gitbundle"))} ${quote(ref)}; git -C ${quote(join(host.remote, name))} checkout --quiet --detach ${quote(revision)}`,
        { signal: abort.signal },
      );
    }
    for (const name of ["scripts", "patches", "adapters"])
      await transfer(
        host,
        join(site, name),
        join(host.remote, "site") + "/",
        true,
      );
    await ssh(
      host,
      `mkdir -p ${quote(join(host.remote, "site/corpora/features"))}`,
    );
    await transfer(
      host,
      join(site, "corpora/features/generator.mjs"),
      join(host.remote, "site/corpora/features/generator.mjs"),
      true,
    );
    await transfer(
      host,
      join(site, "wasmbench.config.json"),
      join(host.remote, "site") + "/",
      true,
    );
    await ssh(
      host,
      `mkdir -p ${quote(join(base, "corpus-cache"))} ${quote(join(host.remote, "site/.wasmbench"))}; ln -sfn ${quote(join(base, "corpus-cache"))} ${quote(join(host.remote, "site/.wasmbench/corpus-cache"))}`,
    );
    const files = new Set(
      plan.jobs.flatMap((j) =>
        j.workloads.flatMap((w) => [
          w.artifact,
          ...Object.values(w.command?.files || {})
            .map((f) => f.path)
            .filter(Boolean),
        ]),
      ),
    );
    for (const path of files) {
      const target = join(host.remote, "site/.wasmbench/corpus-cache", path);
      await ssh(host, `mkdir -p ${quote(resolve(target, ".."))}`);
      await transfer(host, join(cacheDirectory(site), path), target, true);
    }
    await atomicJSON(join(local, "plan.json"), plan);
    await atomicJSON(join(local, "host.json"), host);
    for (const name of ["plan.json", "host.json"])
      await transfer(
        host,
        join(local, name),
        join(host.remote, "session", name),
        true,
      );
    return host;
  }
  try {
    const hosts = [];
    for (const machine of plan.machines) {
      console.log(`[${machine.name}] preparing pinned tools`);
      const host = await setup(machine);
      hosts.push(host);
      const local = join(directory, "hosts", host.name);
      if (action === "resume") {
        if (host.ssh)
          await ssh(
            host,
            host.prefix + killScript(join(host.remote, "session/state.json")),
            { check: false },
          );
        else
          await runCommand(
            process.execPath,
            ["-e", stopCode(join(local, "state.json"))],
            { check: false },
          );
        for (let attempt = 0; attempt < 40; attempt++) {
          const old = host.ssh
            ? await ssh(
                host,
                `cat ${quote(join(host.remote, "session/state.json"))}`,
                { check: false },
              ).then((r) => {
                try {
                  return JSON.parse(r.output);
                } catch {
                  return null;
                }
              })
            : await readJSON(join(local, "state.json")).catch(() => null);
          if (!old || old.status !== "running") break;
          const probe = host.ssh
            ? await ssh(host, `ps -p ${Number(old.pid)} -o command=`, {
                check: false,
              })
            : await runCommand(
                "ps",
                ["-p", String(old.pid), "-o", "command="],
                { check: false },
              );
          const session = host.ssh ? join(host.remote, "session") : local;
          if (
            probe.code !== 0 ||
            !probe.output.includes("benchmark-host.mjs") ||
            !probe.output.includes(session)
          )
            break;
          await new Promise((r) => setTimeout(r, 250));
          if (attempt === 39)
            throw Error(
              "Previous host supervisor has not stopped; use benchmark-stop " +
                id,
            );
        }
      }
      if (host.ssh)
        await ssh(
          host,
          host.prefix +
            `cd ${quote(host.remote + "/site")}; node scripts/benchmark-prepare.mjs ${quote(host.remote + "/session")}`,
          { signal: abort.signal, log: join(local, "setup.log"), quiet: false },
        );
      else
        await runCommand(
          process.execPath,
          [join(host.site || site, "scripts/benchmark-prepare.mjs"), local],
          { cwd: site, signal: abort.signal, quiet: false },
        );
    }
    await Promise.all(
      hosts.map(async (host) => {
        const local = join(directory, "hosts", host.name),
          onLine = (line) => {
            let event;
            try {
              event = JSON.parse(line);
            } catch {
              return;
            }
            if (!event.benchmarkEvent) return;
            human(event);
            if (event.status === "completed" && event.result)
              uploading = uploading
                .then(() => publish(host, event))
                .catch((e) => {
                  uploadError = e;
                  abort.abort();
                });
          };
        try {
          if (host.ssh)
            await ssh(
              host,
              host.prefix +
                `cd ${quote(host.remote + "/site")}; WASMBENCH_V8_COMPILER_MODE=${quote(plan.collection.v8CompilerMode)} node scripts/benchmark-host.mjs ${quote(host.remote + "/session")}`,
              { signal: abort.signal, log: join(local, "host.log"), onLine },
            );
          else
            await runCommand(
              process.execPath,
              [join(host.site || site, "scripts/benchmark-host.mjs"), local],
              {
                cwd: site,
                env: {
                  ...process.env,
                  WASMBENCH_V8_COMPILER_MODE: plan.collection.v8CompilerMode,
                },
                signal: abort.signal,
                log: join(local, "host.log"),
                onLine,
              },
            );
        } catch (e) {
          failed = true;
          console.error(`[${host.name}] ${e.message}`);
        }
      }),
    );
    await uploading;
    if (uploadError) throw uploadError;
    if (abort.signal.aborted)
      throw Error("Interrupted; resume with the saved ID");
    if (failed)
      throw Error("Some hosts are incomplete; resume with the saved ID");
    if (plan.deploy) {
      const dirty = command("git", ["diff", "--name-only", "HEAD"])
        .toString()
        .trim()
        .split("\n")
        .filter(Boolean)
        .filter(
          (p) =>
            !p.startsWith("data/wasmbench/") &&
            !p.startsWith("data/benchmark-runs/") &&
            !p.startsWith("static/wasmbench/"),
        );
      if (dirty.length)
        throw Error(
          "Commit workflow/site changes before --deploy: " + dirty.join(", "),
        );
      await runCommand("just", ["build"], { cwd: site, quiet: false });
      const branch = command("git", ["branch", "--show-current"])
        .toString()
        .trim();
      if (!branch) throw Error("Deploy requires a named Git branch");
      await runCommand(
        "git",
        ["add", "data/wasmbench", "data/benchmark-runs", "static/wasmbench"],
        { cwd: site },
      );
      const staged = await runCommand(
        "git",
        [
          "diff",
          "--cached",
          "--quiet",
          "--",
          "data/wasmbench",
          "data/benchmark-runs",
          "static/wasmbench",
        ],
        { cwd: site, check: false },
      );
      if (staged.code === 1)
        await runCommand(
          "git",
          [
            "commit",
            "--only",
            "-m",
            "Publish benchmark run " + id,
            "--",
            "data/wasmbench",
            "data/benchmark-runs",
            "static/wasmbench",
          ],
          { cwd: site, quiet: false },
        );
      else if (staged.code !== 0) throw Error("Cannot inspect staged dataset");
      await runCommand("git", ["push", "-u", "origin", branch], {
        cwd: site,
        quiet: false,
      });
      const dispatched = Date.now();
      await runCommand(
        "gh",
        ["workflow", "run", "deploy-pages.yml", "--ref", branch],
        { cwd: site, quiet: false },
      );
      console.log("Pages deployment queued for " + branch);
      const sha = command("git", ["rev-parse", "HEAD"]).toString().trim();
      let deployed;
      for (let attempt = 0; attempt < 24; attempt++) {
        const listing = await runCommand(
          "gh",
          [
            "run",
            "list",
            "--workflow",
            "deploy-pages.yml",
            "--branch",
            branch,
            "--event",
            "workflow_dispatch",
            "--limit",
            "10",
            "--json",
            "databaseId,headSha,createdAt,url",
          ],
          { cwd: site },
        );
        deployed = JSON.parse(listing.output).find(
          (r) =>
            r.headSha === sha && Date.parse(r.createdAt) >= dispatched - 5000,
        );
        if (deployed) break;
        if (attempt % 4 === 0)
          console.log("Waiting for Pages workflow registration…");
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (!deployed)
        throw Error(
          "Pages dispatch was accepted but no matching workflow appeared; inspect GitHub Actions.",
        );
      await runCommand(
        "gh",
        [
          "run",
          "watch",
          String(deployed.databaseId),
          "--exit-status",
          "--interval",
          "10",
        ],
        { cwd: site, signal: abort.signal, quiet: false },
      );
      console.log("Pages deployment passed: " + deployed.url);
    }
    const verdicts = { PASS: 0, FAIL: 0, UNSUPPORTED: 0, "NOT MEASURED": 0 };
    for (const machine of plan.machines)
      for (const job of plan.jobs) {
        const result = await readJSON(
          join(directory, "hosts", machine.name, "jobs", job.id, "result.json"),
        );
        verdicts[result.verdict] = (verdicts[result.verdict] || 0) + 1;
      }
    await atomicJSON(join(directory, "summary.json"), {
      id,
      verdicts,
      finished: new Date().toISOString(),
    });
    await atomicJSON(coordinatorPath, {
      pid: process.pid,
      status: verdicts.FAIL ? "completed-with-failures" : "completed",
      id,
      finished: new Date().toISOString(),
    });
    console.log(
      `Finished ${id}: ${verdicts.PASS} PASS · ${verdicts.FAIL} FAIL · ${verdicts.UNSUPPORTED} unsupported. Results: ${directory}`,
    );
    if (verdicts.FAIL) process.exitCode = 2;
  } catch (e) {
    if (abort.signal.aborted) {
      for (const name of await directories(join(directory, "hosts")).catch(
        () => [],
      )) {
        const host = await readJSON(
          join(directory, "hosts", name, "host.json"),
        );
        if (host.ssh)
          await ssh(
            host,
            host.prefix + killScript(join(host.remote, "session/state.json")),
            { check: false },
          ).catch(() => {});
      }
    }
    await atomicJSON(coordinatorPath, {
      pid: process.pid,
      status: abort.signal.aborted ? "paused" : "incomplete",
      id,
      error: e.message,
    });
    console.error(e.message);
    process.exitCode = abort.signal.aborted ? 130 : 1;
  }
} catch (error) {
  console.error(process.env.BENCHMARK_DEBUG ? error.stack : error.message);
  process.exitCode = 1;
}
