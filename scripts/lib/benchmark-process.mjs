import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export const quote = (value) =>
  "'" + String(value).replaceAll("'", "'\\''") + "'";
export async function runCommand(
  program,
  args,
  {
    cwd,
    env = process.env,
    signal,
    log,
    onLine,
    quiet = true,
    check = true,
  } = {},
) {
  if (signal?.aborted) throw Error("Interrupted");
  if (log) await mkdir(dirname(log), { recursive: true });
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      pending = "",
      writes = Promise.resolve(),
      timer;
    const kill = () => {
      try {
        process.kill(
          process.platform === "win32" ? child.pid : -child.pid,
          "SIGTERM",
        );
      } catch {}
      timer = setTimeout(() => {
        try {
          process.kill(
            process.platform === "win32" ? child.pid : -child.pid,
            "SIGKILL",
          );
        } catch {}
      }, 2000);
      timer.unref();
    };
    signal?.addEventListener("abort", kill, { once: true });
    const chunk = (bytes, stderr) => {
      const text = bytes.toString();
      output = (output + text).slice(-4 * 1024 * 1024);
      if (log) writes = writes.then(() => appendFile(log, bytes));
      if (!quiet) (stderr ? process.stderr : process.stdout).write(bytes);
      if (!stderr && onLine) {
        pending += text;
        let i;
        while ((i = pending.indexOf("\n")) >= 0) {
          onLine(pending.slice(0, i));
          pending = pending.slice(i + 1);
        }
      }
    };
    child.stdout.on("data", (b) => chunk(b, false));
    child.stderr.on("data", (b) => chunk(b, true));
    const finish = () => {
      signal?.removeEventListener("abort", kill);
      if (timer) clearTimeout(timer);
    };
    child.on("error", (e) => {
      finish();
      reject(e);
    });
    child.on("close", async (code, killed) => {
      finish();
      try {
        await writes;
        if (pending && onLine) onLine(pending);
        if (signal?.aborted) throw Error("Interrupted");
        if (check && code !== 0)
          throw Error(
            `${program} exited ${code ?? killed}; see ${log || "output"}\n${output.slice(-2000)}`,
          );
        resolve({ code, output, pid: child.pid });
      } catch (e) {
        reject(e);
      }
    });
  });
}
