import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {fileURLToPath} from "node:url";
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
  if(process.platform==='darwin'&&env.WASMBENCH_SHARED_DEVICE_RESERVED!=='1'){
    args=[fileURLToPath(new URL('../shared-device-run.py',import.meta.url)),'--','env','WASMBENCH_SHARED_DEVICE_RESERVED=1',program,...args];
    program='python3';
  }
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
      timer, escalation;
    const kill = () => {
      try {
        process.kill(
          process.platform === "win32" ? child.pid : -child.pid,
          "SIGTERM",
        );
      } catch {}
      escalation = new Promise(done => { timer = setTimeout(() => {
        try {
          process.kill(
            process.platform === "win32" ? child.pid : -child.pid,
            "SIGKILL",
          );
        } catch {}
        done();
      }, 2000); });
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
      // An aborted leader can exit before a child that ignored SIGTERM.
      // Retain process-group escalation until every descendant is killed.
      if (timer && !signal?.aborted) clearTimeout(timer);
    };
    child.on("error", async (e) => {
      finish();
      if (signal?.aborted) await escalation;
      reject(e);
    });
    child.on("close", async (code, killed) => {
      finish();
      try {
        if (signal?.aborted) await escalation;
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


// A controller can own an adapter, compiler and runtime. Kill the complete
// process group on cancellation rather than leaving those descendants alive.
export function runBenchmarkProcess(program,args,{cwd,env=process.env,signal}={}) {
 signal?.throwIfAborted();
 if(process.platform==='darwin'&&env.WASMBENCH_SHARED_DEVICE_RESERVED!=='1'){
  args=[fileURLToPath(new URL('../shared-device-run.py',import.meta.url)),'--','env','WASMBENCH_SHARED_DEVICE_RESERVED=1',program,...args];
  program='python3';
 }
 return new Promise((resolve,reject)=>{
  const child=spawn(program,args,{cwd,env,detached:true,stdio:['ignore','ignore','pipe']});
  let stderr='',force,reason,escalation;
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8192)});
  const kill=kind=>{if(child.pid)try{process.kill(-child.pid,kind)}catch(error){if(error.code!=='ESRCH')throw error}};
  const cancel=()=>{
   reason=signal.reason||Error('Benchmark cancelled');kill('SIGTERM');
   escalation=new Promise(done=>{force=setTimeout(()=>{kill('SIGKILL');done()},2000)});
  };
  const cleanup=()=>{signal?.removeEventListener('abort',cancel)};
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  child.on('error',async error=>{cleanup();if(reason)await escalation;reject(error)});
  child.on('exit',async(code,termination)=>{
   cleanup();
   // The leader may exit before grandchildren; retain escalation on abort.
   if(!reason)clearTimeout(force);
   if(reason){await escalation;reject(reason);}
   else if(code===0)resolve();
   else reject(Error(stderr||`Controller exited ${code??termination}`));
  });
 });
}
