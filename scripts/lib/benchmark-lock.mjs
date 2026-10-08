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
export async function processLock(path, fn, {legacyPid = false} = {}) {
  await mkdir(dirname(path), { recursive: true });
  const owner = {
      pid: process.pid,
      token: randomUUID(),
      started: await started(process.pid),
    },
    candidate = path + "." + owner.token;
  if (!owner.started) throw Error("Cannot establish process start identity");
  await writeFile(candidate, JSON.stringify(owner));
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 14400; attempt++) {
      try {
        await link(candidate, path);
        acquired = true;
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        let previous, previousBytes;
        try {
          previousBytes = await readFile(path, "utf8");
          previous = JSON.parse(previousBytes);
        } catch (e) {
          if (e.code === "ENOENT") continue;
          throw e;
        }
        const numeric = typeof previous === "number";
        if (numeric && !legacyPid) throw Error("Legacy process lock requires explicit migration");
        const pid = numeric ? previous : previous?.pid;
        if (!Number.isSafeInteger(pid) || pid <= 0 || (!numeric &&
            (typeof previous.started !== "string" || !previous.started ||
             typeof previous.token !== "string" || !previous.token)))
          throw Error("Invalid process lock owner");
        let dead = false;
        try { process.kill(pid, 0); }
        catch (error) { if (error.code === "ESRCH") dead = true; else if (error.code !== "EPERM") throw error; }
        // A failed ps probe is not evidence that a live owner stopped.
        const observed = dead || numeric ? null : await started(pid);
        if (dead || (observed && observed !== previous.started)) {
          const current = await readFile(path, "utf8").catch(error => {
            if (error.code !== "ENOENT") throw error;
            return null;
          });
          if (current === previousBytes) await rm(path, { force: true });
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
