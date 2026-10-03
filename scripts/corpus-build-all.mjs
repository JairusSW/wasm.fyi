// One command builds every configured application and feature artifact.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { site } from './lib/wasmbench.mjs';
for(const [script,args] of [
  ['wasi-sdk-toolchain.mjs',[]],
  ['application-corpus.mjs',['build']],
  ['feature-corpus.mjs',['build']],
  ['corpus-rebuild.mjs',[]],
  ['corpus-v8.mjs',['--from-source']],
  ['corpus-components-check.mjs',[]],
  ['corpus-audit.mjs',[]]
]) {
  console.log('Building/checking',script);
  await new Promise((ok,fail)=>{const p=spawn(process.execPath,[join(site,'scripts',script),...args],{cwd:site,env:process.env,stdio:'inherit'});p.on('error',fail);p.on('exit',code=>code===0?ok():fail(Error(`${script} exited ${code}`)));});
}
console.log('Every configured corpus artifact was compiled from source and checked.');
