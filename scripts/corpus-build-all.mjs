// One command builds every configured application and feature artifact.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {benchmarkSource} from './lib/benchmark-source.mjs';
import {config,site} from './lib/wasmbench.mjs';

async function runScript(script,args,env){
 console.log('Building/checking',script);
 await new Promise((ok,fail)=>{const p=spawn(process.execPath,[join(site,'scripts',script),...args],{cwd:site,env,stdio:'inherit'});p.on('error',fail);p.on('exit',code=>code===0?ok():fail(Error(`${script} exited ${code}`)));});
}

export async function buildCorpusFromSource({env=process.env,loadSettings=config,resolveHarness=benchmarkSource,run=runScript}={}){
 for(const [script,args] of [
  ['wasi-sdk-toolchain.mjs',[]],
  ['application-corpus.mjs',['build']],
  ['feature-corpus.mjs',['build']],
  ['corpus-rebuild.mjs',[]],
  ['corpus-v8.mjs',['--from-source']],
  ['corpus-components-check.mjs',[]],
 ])await run(script,args,env);
 const root=await resolveHarness(await loadSettings());
 await run('corpus-audit.mjs',[],{...env,WASMBENCH_ROOT:root});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await buildCorpusFromSource();
 console.log('Every configured portable corpus artifact was compiled from source and checked. Native embedding builds: just features-proposals-source-check.');
}
