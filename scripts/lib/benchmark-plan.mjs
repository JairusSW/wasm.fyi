import { readFile, writeFile, mkdir, rename, copyFile } from "node:fs/promises";
import { join, resolve, dirname, relative } from "node:path";
import { digest } from "./wasmbench.mjs";
import { parseCorpusJSON, rebaseRetainedWorkload } from "./corpus.mjs";

export const cacheDirectory = (root) => join(root, ".wasmbench/corpus-cache");
export async function atomicJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + ".tmp-" + process.pid;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
}
export function workerCount(value, cores) {
  if (!Number.isSafeInteger(cores) || cores < 1)
    throw Error("Invalid available core count");
  const text = String(value ?? "25%");
  let n;
  if (/^\d+(?:\.\d+)?%$/.test(text)) {
    const percent = Number(text.slice(0, -1));
    if (percent <= 0 || percent > 100)
      throw Error("Worker percentage must be greater than 0 and at most 100");
    n = Math.max(1, Math.floor((cores * percent) / 100));
  } else if (/^\d+$/.test(text)) n = Number(text);
  else throw Error("Workers must be a core count or percentage, e.g. 4 or 25%");
  const limit = Math.max(1, Math.floor(cores / 4));
  if (!Number.isSafeInteger(n) || n < 1 || n > limit)
    throw Error(`Worker count must be between 1 and ${limit} (quarter-core budget)`);
  return n;
}
export function machineWorkers(text, name) {
  if (!String(text).includes("=")) return text;
  const pairs = String(text)
    .split(",")
    .map((x) => x.split("="));
  if (
    pairs.some((p) => p.length !== 2 || !p[0] || !p[1]) ||
    new Set(pairs.map((p) => p[0])).size !== pairs.length
  )
    throw Error("Use --workers local=25%,hub=25%");
  return new Map(pairs).get(name) || "25%";
}
export function selectWorkloads(
  workloads,
  { kind = "non-feature", corpus = [] } = {},
) {
  if (!["non-feature", "features", "both"].includes(kind))
    throw Error("Kind must be non-feature, features, or both");
  const eligible = workloads.filter(
    (w) =>
      kind === "both" || (kind === "features") === w.id.startsWith("features/"),
  );
  if (!corpus.length) return eligible;
  const matches = (w, selector) =>
    selector === w.id ||
    selector === w.id.split("/")[1] ||
    w.id.startsWith(selector.replace(/\/$/, "") + "/");
  for (const selector of corpus)
    if (!eligible.some((w) => matches(w, selector)))
      throw Error(`No ${kind} corpus matches ${selector}`);
  return eligible.filter((w) =>
    corpus.some((selector) => matches(w, selector)),
  );
}
// Artifacts and input files are content-addressed. No build command is called here.
export async function cacheWorkloads(root, workloads) {
  const cache = cacheDirectory(root),
    path = join(cache, "manifest.json");
  await mkdir(join(cache, "artifacts"), { recursive: true });
  await mkdir(join(cache, "inputs"), { recursive: true });
  const previous = await readFile(path, "utf8").then(parseCorpusJSON, (e) => {
    if (e.code !== "ENOENT") throw e;
    return { schema: 1, workloads: [] };
  });
  const entries = new Map(previous.workloads.map((w) => [w.id, w]));
  for (const workload of workloads) {
    const w = structuredClone(workload),
      bytes = await readFile(w.artifact);
    if (digest(bytes) !== w.sha256)
      throw Error(`Artifact digest mismatch: ${w.id}; rebuild explicitly`);
    w.artifact = `artifacts/${w.sha256}.wasm`;
    await writeFile(join(cache, w.artifact), bytes);
    for (const [name, file] of Object.entries(w.command?.files || {})) {
      if (!file.path) {
        if (
          file.data != null &&
          file.sha256 &&
          digest(Buffer.from(file.data, "base64")) !== file.sha256
        )
          throw Error(`Inline input digest mismatch: ${w.id}/${name}`);
        continue;
      }
      const bytes = await readFile(file.path),
        sha256 = digest(bytes);
      if (file.sha256 && file.sha256 !== sha256)
        throw Error(`Input digest mismatch: ${w.id}/${name}`);
      file.path = `inputs/${sha256}`;
      file.sha256 = sha256;
      await writeFile(join(cache, file.path), bytes);
    }
    entries.set(w.id, w);
  }
  const result = {
    schema: 1,
    updated: new Date().toISOString(),
    workloads: [...entries.values()],
  };
  await atomicJSON(path, result);
  return result;
}
export async function readCache(root) {
  const cache = cacheDirectory(root),
    data = await readFile(join(cache, "manifest.json"), "utf8").then(
      parseCorpusJSON,
      (e) => {
        if (e.code === "ENOENT")
          throw Error(
            "No Wasm cache. Run just corpus-build or just corpus-cache first; measurement never rebuilds artifacts.",
          );
        throw e;
      },
    );
  if (
    data.schema !== 1 ||
    !Array.isArray(data.workloads) ||
    !data.workloads.length ||
    new Set(data.workloads.map((w) => w.id)).size !== data.workloads.length
  )
    throw Error("Invalid corpus cache manifest");
  return data.workloads.map((w) => {
    w = structuredClone(w);
    const safe = (p) => {
      const path = resolve(cache, p);
      if (relative(cache, path).startsWith(".."))
        throw Error("Unsafe cached artifact path");
      return path;
    };
    w.artifact = safe(w.artifact);
    for (const file of Object.values(w.command?.files || {}))
      if (file.path) file.path = safe(file.path);
    return w;
  });
}
export async function verifyWorkloads(workloads) {
  for (const w of workloads) {
    if (digest(await readFile(w.artifact)) !== w.sha256)
      throw Error(`Cached artifact changed: ${w.id}; rebuild explicitly`);
    for (const [name, file] of Object.entries(w.command?.files || {}))
      if (
        digest(
          file.path
            ? await readFile(file.path)
            : Buffer.from(file.data || "", "base64"),
        ) !== file.sha256
      )
        throw Error(`Cached input changed: ${w.id}/${name}`);
  }
}
export async function existingWorkloads(root, settings) {
  const workloads = [];
  const load = async (path, prefix) => {
    let entries;
    try {
      entries = parseCorpusJSON(await readFile(path, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    for (let w of entries) {
      w = rebaseRetainedWorkload(w, root);
      if (!w.artifact.startsWith("/")) w.artifact = resolve(prefix, w.artifact);
      for (const f of Object.values(w.command?.files || {}))
        if (f.path && !f.path.startsWith("/")) f.path = resolve(root, f.path);
      workloads.push(w);
    }
  };
  if (settings.corpus.buildManifest)
    await load(resolve(root, settings.corpus.buildManifest), root);
  if (settings.corpus.applications)
    await load(
      resolve(root, settings.corpus.applications),
      dirname(resolve(root, settings.corpus.applications)),
    );
  await load(
    join(root, "corpora/features/manifest.json"),
    join(root, "corpora/features"),
  );
  const calls = [
    join(cacheDirectory(root), "calls.json"),
    join(root, ".wasmbench/full-run-input/host-calls.json"),
    join(root, ".wasmbench/full-run-input/calls.json"),
  ];
  for (const path of calls) {
    try {
      await readFile(path);
      await load(path, cacheDirectory(root));
      break;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  if (!workloads.length)
    throw Error("No built artifacts found. Run just corpus-build.");
  return workloads;
}
export function portableWorkloads(root, workloads) {
  const cache = cacheDirectory(root);
  return workloads.map((w) => {
    w = structuredClone(w);
    w.artifact = relative(cache, w.artifact);
    for (const f of Object.values(w.command?.files || {}))
      if (f.path) f.path = relative(cache, f.path);
    return w;
  });
}
export function restoreWorkloads(root, workloads) {
  const cache = cacheDirectory(root);
  return workloads.map((w) => {
    w = structuredClone(w);
    const safe = (p) => {
      const path = resolve(cache, p);
      if (relative(cache, path).startsWith(".."))
        throw Error("Unsafe plan artifact path");
      return path;
    };
    w.artifact = safe(w.artifact);
    for (const f of Object.values(w.command?.files || {}))
      if (f.path) f.path = safe(f.path);
    return w;
  });
}
export function lockedPlanBytes(plan) {
  const { id, created, identity, ...locked } = plan;
  return Buffer.from(JSON.stringify(locked));
}
export function planIdentity(plan) {
  return digest(lockedPlanBytes(plan));
}
