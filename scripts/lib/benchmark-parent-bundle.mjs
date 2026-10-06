// Shared parent archive writer for current and historical collection. The
// archive format, exact tool identities and one writer per member are retained.
import {readFile,writeFile,mkdir,cp,rm,open,readdir,stat} from "node:fs/promises";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import {digest} from "./wasmbench.mjs";
import {atomicJSON} from "./benchmark-plan.mjs";
import {runCommand} from "./benchmark-process.mjs";

async function hashFile(path, signal) {
  const hash = createHash("sha256");
  for await (const b of createReadStream(path, {signal})) hash.update(b);
  return hash.digest("hex");
}
export async function retainCollectionParent({ root, log, bundle, profile, plan, host, env, signal, workerPolicy, pack, packing }) {
  signal?.throwIfAborted();
  if (profile !== "timing") return;
  const manifest = JSON.parse(await readFile(join(bundle, "manifest.json")));
  const main = join(root, "bundle");
  const checkIdentity = async () => {
    const metadata = JSON.parse(await readFile(join(main, "metadata.json")));
    const index = JSON.parse(await readFile(join(main, "index.json")));
    if (
      index.id !== plan.id || index.machine !== host.name ||
      metadata.id !== plan.id ||
      metadata.planSha256 !== plan.identity ||
      JSON.stringify(metadata.runtimes) !==
        JSON.stringify(manifest.lock.runtime_configurations)
    )
      throw Error("Runtime tools/configuration changed within this session");
  };
  await mkdir(main, { recursive: true });
  let lock, archive;
  try {
    lock = await open(join(root, "bundle.lock"), "wx");
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    while (true) {
      if (signal?.aborted) throw Error("Interrupted");
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
        if (e.code === "ENOENT") return retainCollectionParent({ root, log, bundle, profile, plan, host, env, signal, workerPolicy, pack, packing });
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
      ...(packing ? {packing} : {}),
      workerPolicy: workerPolicy ?? {
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
    // A historical packer left alive after its parent dies can only write its
    // own staging file, never the next publisher's archive or immutable index.
    archive = join(root, pack ? ".parent-archive-" + randomUUID() + ".tar.gz" : "bundle.tar.gz");
    // This is the writer's owned staging file. A killed packer can leave it
    // behind without an index; a retry must rebuild it rather than reuse it.
    await rm(archive, { force: true });
    if (pack) await pack(main, archive);
    else await runCommand("tar", ["-czf", archive, "-C", main, "."], {
      signal,
      log,
    });
    const bytes = (await stat(archive)).size,
      sha256 = await hashFile(archive, signal);
    const parts = [];
    let index = 0;
    // Keep each published file below GitHub's single-file size limit.
    for await (const chunk of createReadStream(archive, {
      highWaterMark: 32 * 1024 * 1024,
      signal,
    })) {
      const name = `bundle.tar.gz.part-${String(index++).padStart(3, "0")}`;
      signal?.throwIfAborted();
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
    await rm(join(main, "tools"), { recursive: true, force: true });
  } finally {
    try { if (archive) await rm(archive, { force: true }); }
    finally { await lock.close(); await rm(join(root, "bundle.lock"), { force: true }); }
  }
}
