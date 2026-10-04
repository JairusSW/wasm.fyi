import { readFile, mkdir, mkdtemp, cp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { site, installDirectory, exists } from "./wasmbench.mjs";
import { processLock } from "./benchmark-lock.mjs";
import { atomicJSON } from "./benchmark-plan.mjs";
import { runCommand } from "./benchmark-process.mjs";
import { validateData } from "./validate-data.mjs";
import { appendReports, writeIndex } from "./snapshot-index.mjs";
// Import only the newly completed corpus; retain the rest of the dataset.
export async function publishCorpus(paths) {
  return processLock(
    join(site, ".wasmbench/benchmark-publish.lock"),
    async () => {
      await mkdir(join(site, ".wasmbench"), { recursive: true });
      const journal = join(site, ".wasmbench/benchmark-publish.json"),
        current = join(site, "data/wasmbench");
      const interrupted = await readFile(journal, "utf8").then(
        JSON.parse,
        (e) => {
          if (e.code !== "ENOENT") throw e;
          return null;
        },
      );
      if (interrupted) {
        if (!(await exists(current)) && (await exists(interrupted.backup))) {
          const { rename } = await import("node:fs/promises");
          await rename(interrupted.backup, current);
        }
        await validateData(current);
        await rm(interrupted.backup, { recursive: true, force: true });
        await rm(journal, { force: true });
      }
      const temp = await mkdtemp(join(site, ".wasmbench/live-import-"));
      let finish;
      try {
        const incoming = join(temp, "incoming");
        await runCommand(
          process.execPath,
          [
            join(site, "scripts/import-wasmbench.mjs"),
            "--output",
            incoming,
            ...paths,
          ],
          { cwd: site, log: join(temp, "import.log") },
        );
        const staged = join(temp, "merged");
        await cp(current, staged, { recursive: true });
        const previous = await validateData(current),
          next = await validateData(incoming);
        for (const name of await readdir(incoming))
          if (name !== "index.json")
            await cp(join(incoming, name), join(staged, name));
        await writeIndex(staged, appendReports(previous.reports, next.reports));
        await validateData(staged);
        const backup = current + ".previous-" + process.pid;
        await atomicJSON(journal, { backup, temp, pid: process.pid });
        finish = await installDirectory(staged, current, backup);
        await runCommand(
          process.execPath,
          [join(site, "scripts/view-data.mjs")],
          { cwd: site, log: join(temp, "view.log") },
        );
        await runCommand(
          process.execPath,
          [join(site, "scripts/stage-data.mjs")],
          { cwd: site, log: join(temp, "stage.log") },
        );
        await finish(false);
        finish = null;
        await rm(journal, { force: true });
      } catch (e) {
        if (finish) {
          await finish(true);
          await rm(journal, { force: true });
          await runCommand(
            process.execPath,
            [join(site, "scripts/view-data.mjs")],
            { cwd: site },
          );
        }
        throw e;
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    },
  );
}
