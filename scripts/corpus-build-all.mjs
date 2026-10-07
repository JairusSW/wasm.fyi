// One command builds every configured application and feature artifact.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { site, config } from './lib/wasmbench.mjs';
import { benchmarkSource } from './lib/benchmark-source.mjs';

async function runScript(script,args,env) {
  console.log('Building/checking',script);
  await new Promise((ok,fail)=>{const p=spawn(process.execPath,[join(site,'scripts',script),...args],{cwd:site,env,stdio:'inherit'});p.on('error',fail);p.on('exit',code=>code===0?ok():fail(Error(`${script} exited ${code}`)));});
}
export async function buildCorpusFromSource({run=runScript,resolveHarness=benchmarkSource,loadSettings=config,env=process.env}={}) {
  for(const [script,args] of [
    ['wasi-sdk-toolchain.mjs',[]],
    ['application-corpus.mjs',['build']],
    ['feature-corpus.mjs',['build']],
    ['corpus-rebuild.mjs',[]],
    ['main-corpus-check.mjs',[]],
    ['corpus-v8.mjs',['--from-source']],
    ['corpus-components-check.mjs',[]]
  ])await run(script,args,env);
  // The audit also generates host-call fixtures from the harness sources.
  // A clean checkout has no developer-local ../../Tools/wasm-bench tree.
  const root=await resolveHarness(await loadSettings());
  await run('corpus-audit.mjs',[],{...env,WASMBENCH_ROOT:root});
  console.log('Every configured corpus artifact was compiled from source and checked.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await buildCorpusFromSource();
