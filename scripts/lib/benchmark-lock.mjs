import { readFile, writeFile, link, rm, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { runCommand } from "./benchmark-process.mjs";
async function started(pid) {
  try {
    return (
      await runCommand("ps", ["-p", String(pid), "-o", "lstart="])
    ).output.trim();
  } catch {
    return null;
  }
}
// Complete owner records are linked atomically. Dead owners do not block resume.
export async function processLock(path, fn) {
  await mkdir(dirname(path), { recursive: true });
  const owner = {
      pid: process.pid,
      token: randomUUID(),
      started: await started(process.pid),
    },
    candidate = path + "." + owner.token;
  await writeFile(candidate, JSON.stringify(owner));
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 1200; attempt++) {
      try {
        await link(candidate, path);
        acquired = true;
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        let previous;
        try {
          previous = JSON.parse(await readFile(path));
        } catch (e) {
          if (e.code === "ENOENT") continue;
          throw e;
        }
        if ((await started(previous.pid)) !== previous.started) {
          const current = JSON.parse(await readFile(path));
          if (current.token === previous.token) await rm(path, { force: true });
          continue;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!acquired) throw Error("Another live process holds " + path);
    return await fn();
  } finally {
    await rm(candidate, { force: true });
    if (acquired) {
      const current = await readFile(path, "utf8").then(JSON.parse, (e) => {
        if (e.code !== "ENOENT") throw e;
        return null;
      });
      if (current?.token === owner.token) await rm(path, { force: true });
    }
  }
}
