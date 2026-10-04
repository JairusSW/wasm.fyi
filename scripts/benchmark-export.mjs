import { resolve, join } from "node:path";
import { stat, mkdir, readdir, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { site } from "./lib/wasmbench.mjs";
import { runCommand } from "./lib/benchmark-process.mjs";
const [id, output] = process.argv.slice(2);
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(id || "") || !output)
  throw Error("Usage: just bench-export ID output.tar.gz");
const root = join(site, ".wasmbench/benchmark-runs", id),
  staged = await mkdtemp(join(tmpdir(), "benchmark-export-"));
try {
  for (const name of ["plan.json", "coordinator.json", "summary.json"])
    if (await stat(join(root, name)).catch(() => false))
      await cp(join(root, name), join(staged, name));
  for (const host of (
    await readdir(join(root, "hosts"), { withFileTypes: true })
  ).filter((e) => e.isDirectory())) {
    const source = join(root, "hosts", host.name),
      target = join(staged, "hosts", host.name);
    await mkdir(target, { recursive: true });
    for (const name of [
      "jobs",
      "bundle",
      "host.json",
      "state.json",
      "setup.log",
      "host.log",
    ])
      if (await stat(join(source, name)).catch(() => false))
        await cp(join(source, name), join(target, name), {
          recursive: true,
          filter: (p) =>
            !p.endsWith("/.DS_Store") &&
            !p.endsWith("/.wasmbench") &&
            !/\/corpus-\d+\/corpus-\d+$/.test(p),
        });
  }
  await runCommand("tar", ["-czf", resolve(output), "-C", staged, "."], {
    quiet: false,
  });
  console.log(resolve(output));
} finally {
  await rm(staged, { recursive: true, force: true });
}
