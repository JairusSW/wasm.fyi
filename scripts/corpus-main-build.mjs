// Source-only application workflow, intentionally independent of feature probes.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { site, config } from './lib/wasmbench.mjs';

async function runScript(script,args,env) {
  console.log('Building/checking',script);
  await new Promise((ok,fail)=>{
    const p=spawn(process.execPath,[join(site,'scripts',script),...args],{cwd:site,env,stdio:'inherit'});
    p.on('error',fail);p.on('exit',code=>code===0?ok():fail(Error(`${script} exited ${code}`)));
  });
}
export async function buildMainCorpus({run=runScript,loadSettings=config,env=process.env}={}) {
  const settings=await loadSettings();
  for(const [script,args] of [
    ['wasi-sdk-toolchain.mjs',[]],
    ['application-corpus.mjs',['build']],
    ['corpus-rebuild.mjs',[]],
    ['main-corpus-check.mjs',[]],
    ['corpus-v8.mjs',['--suite-only',settings.corpus.buildManifest]],
  ])await run(script,args,env);
  await run('corpus-audit.mjs',['--main-only'],env);
  console.log('Every main-corpus artifact was compiled from source and passed the non-WASI and execution checks.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await buildMainCorpus();
