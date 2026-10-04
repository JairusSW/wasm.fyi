import { join, resolve } from "node:path";
import { stat, mkdir, rm } from "node:fs/promises";
import { site, command } from "./wasmbench.mjs";
import { runCommand } from "./benchmark-process.mjs";
export async function benchmarkSource(settings) {
  const configured = resolve(site, process.env.WASMBENCH_ROOT || settings.root);
  if (await stat(join(configured, "go.mod")).catch(() => false)) {
    if (
      resolve(
        command("git", ["rev-parse", "--show-toplevel"], { cwd: configured })
          .toString()
          .trim(),
      ) !== configured
    )
      throw Error("Harness root must be its own Git checkout");
    return configured;
  }
  const pin = settings.harnessSource;
  if (
    !/^https:\/\/github.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(
      pin?.repository || "",
    ) ||
    !/^[a-f0-9]{40}$/.test(pin?.revision || "")
  )
    throw Error(
      "Configure root or a pinned harnessSource in wasmbench.config.json",
    );
  const root = join(site, ".wasmbench/harness-source", pin.revision);
  if (!(await stat(join(root, "go.mod")).catch(() => false))) {
    await mkdir(resolve(root, ".."), { recursive: true });
    await rm(root, { recursive: true, force: true });
    await runCommand("git", ["clone", "--quiet", pin.repository, root], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      quiet: false,
    });
    await runCommand("git", ["checkout", "--quiet", "--detach", pin.revision], {
      cwd: root,
    });
  }
  if (
    command("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim() !==
    pin.revision
  )
    throw Error("Cached harness source revision changed");
  return root;
}

// A named ref is required both for bundle creation and for fetching its objects.
export async function sourceBundle(source, revision, path, { signal } = {}) {
  const { randomUUID } = await import("node:crypto");
  const ref = "refs/wasm-fyi-benchmark/" + process.pid + "-" + randomUUID();
  await runCommand("git", ["update-ref", ref, revision], { cwd: source });
  try {
    await runCommand("git", ["bundle", "create", path, ref], {
      cwd: source,
      signal,
    });
  } finally {
    await runCommand("git", ["update-ref", "-d", ref], { cwd: source });
  }
  return ref;
}
