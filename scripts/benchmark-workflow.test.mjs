import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runCommand } from "./lib/benchmark-process.mjs";
import {
  atomicJSON,
  planIdentity,
  restoreWorkloads,
} from "./lib/benchmark-plan.mjs";
import { digest } from "./lib/wasmbench.mjs";
const site = fileURLToPath(new URL("..", import.meta.url));
test("host resumes completed corpora without launching or rewriting a result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-resume-"));
  try {
    const plan = {
      id: "resume-test",
      jobs: [{ id: "corpus-0001", workloads: [] }],
      engines: ["wazero"],
    };
    plan.identity = planIdentity(plan);
    await atomicJSON(join(directory, "plan.json"), plan);
    await atomicJSON(join(directory, "host.json"), {
      name: "local",
      workers: "1",
    });
    const resultPath = join(directory, "jobs/corpus-0001/result.json");
    await atomicJSON(resultPath, { plan: plan.identity, verdict: "PASS" });
    const before = (await stat(resultPath)).mtimeMs;
    await atomicJSON(join(directory, "state.json"), {
      status: "running",
      pid: process.pid,
      jobs: {},
    }); // PID reused by a different command.

    const result = await runCommand(process.execPath, [
      join(site, "scripts/benchmark-host.mjs"),
      directory,
    ]);
    assert.match(result.output, /"resumed":true/);
    assert.equal((await stat(resultPath)).mtimeMs, before);
    assert.equal(
      JSON.parse(await readFile(join(directory, "state.json"))).status,
      "completed",
    );
    await atomicJSON(resultPath, { plan: "mutated" });
    await assert.rejects(
      () =>
        runCommand(process.execPath, [
          join(site, "scripts/benchmark-host.mjs"),
          directory,
        ]),
      /Saved corpus plan changed/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("prepared tool verification rejects mutations before adapter build", async () => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-tools-"));
  try {
    const binary = join(directory, "tool");
    await writeFile(binary, "before");
    await atomicJSON(join(directory, "plan.json"), {
      identity: "locked",
      engines: [],
      collection: {},
    });
    await atomicJSON(join(directory, "host.json"), { harness: directory });
    await atomicJSON(join(directory, "ready.json"), {
      plan: "locked",
      files: [{ path: binary, sha256: digest("before") }],
    });
    await runCommand(process.execPath, [
      join(site, "scripts/benchmark-prepare.mjs"),
      directory,
    ]);
    await writeFile(binary, "after");
    await assert.rejects(
      () =>
        runCommand(process.execPath, [
          join(site, "scripts/benchmark-prepare.mjs"),
          directory,
        ]),
      /Prepared tool changed/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("cancellation terminates the command and its inherited process group", async () => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-kill-"));
  try {
    const pid = join(directory, "child.pid"),
      controller = new AbortController();
    const promise = runCommand(
      process.execPath,
      [
        "-e",
        `const {spawn}=require('child_process');const fs=require('fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pid)},String(c.pid));setInterval(()=>{},1000);`,
      ],
      { signal: controller.signal },
    );
    for (let i = 0; i < 100; i++) {
      if (await stat(pid).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const child = Number(await readFile(pid));
    controller.abort();
    await assert.rejects(promise, /Interrupted/);
    await new Promise((r) => setTimeout(r, 100));
    assert.throws(
      () => process.kill(child, 0),
      (e) => e.code === "ESRCH",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("plan identity locks measurement choices and rejects cache path traversal", () => {
  const plan = { id: "one", created: "today", engines: ["wago"], jobs: [] };
  const hash = planIdentity(plan);
  assert.equal(
    planIdentity({ ...plan, id: "two", created: "tomorrow", identity: hash }),
    hash,
  );
  assert.notEqual(planIdentity({ ...plan, engines: ["v8"] }), hash);
  assert.throws(
    () => restoreWorkloads(site, [{ artifact: "../../outside", command: {} }]),
    /Unsafe plan/,
  );
});

test("source bundles transfer an exact older commit without a GitHub key or leaked local refs", async () => {
  const { sourceBundle } = await import("./lib/benchmark-source.mjs");
  const root = await mkdtemp(join(tmpdir(), "benchmark-source-"));
  try {
    const source = join(root, "source"),
      target = join(root, "target");
    await mkdir(source);
    await mkdir(target);
    const git = async (args, cwd = source) =>
      (await runCommand("git", args, { cwd })).output.trim();
    await git(["init", "--quiet"]);
    await git(["config", "user.name", "Benchmark Test"]);
    await git(["config", "user.email", "benchmark@example.invalid"]);
    await writeFile(join(source, "file"), "first");
    await git(["add", "file"]);
    await git(["commit", "--quiet", "-m", "first"]);
    const revision = await git(["rev-parse", "HEAD"]);
    await writeFile(join(source, "file"), "second");
    await git(["commit", "--quiet", "-am", "second"]);
    const head = await git(["rev-parse", "HEAD"]),
      pack = join(root, "source.bundle"),
      ref = await sourceBundle(source, revision, pack);
    assert.equal(await git(["rev-parse", "HEAD"]), head);
    assert.equal(
      await git([
        "for-each-ref",
        "--format=%(refname)",
        "refs/wasm-fyi-benchmark",
      ]),
      "",
    );
    await git(["init", "--quiet"], target);
    await git(["fetch", "--quiet", pack, ref], target);
    await git(["checkout", "--quiet", "--detach", revision], target);
    assert.equal(await git(["rev-parse", "HEAD"], target), revision);
    assert.equal(await readFile(join(target, "file"), "utf8"), "first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publisher lease survives contention and reclaims an interrupted owner", async () => {
  const { processLock } = await import("./lib/benchmark-lock.mjs");
  const root = await mkdtemp(join(tmpdir(), "benchmark-lock-"));
  try {
    const path = join(root, "lease"),
      order = [];
    let release;
    const held = new Promise((r) => (release = r));
    const first = processLock(path, async () => {
      order.push("first");
      await held;
    });
    while (!(await stat(path).catch(() => false)))
      await new Promise((r) => setTimeout(r, 10));
    const second = processLock(path, async () => order.push("second"));
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(order, ["first"]);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first", "second"]);
    await writeFile(
      path,
      JSON.stringify({ pid: 99999999, started: "dead", token: "interrupted" }),
    );
    await processLock(path, async () => order.push("reclaimed"));
    assert.equal(order.at(-1), "reclaimed");
    assert.equal(await stat(path).catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
