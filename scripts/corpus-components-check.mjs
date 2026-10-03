// V8 has no Component Model API. Check compiled component contracts in Wasmtime.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest, site, command } from './lib/wasmbench.mjs';
const version=command('wasmtime',['--version']).toString().trim();
if(!/^wasmtime 46\.0\.1\b/.test(version))throw Error('Use Wasmtime 46.0.1');
const manifest=JSON.parse(await readFile(join(site,'corpora/features/manifest.json')));
const outcomes=[];
for(const w of manifest.filter(w=>w.abi==='component'||w.abi==='wasi-component')) {
  const artifact=join(site,'corpora/features',w.artifact);
  let directory;
  try {
    if(digest(await readFile(artifact))!==w.sha256)throw Error('Artifact digest differs');
    if(w.oracle.kind==='component_compile_only') {
      const result=spawnSync('wasmtime',['compile',artifact,'-o',join(tmpdir(),`wasm-fyi-component-${process.pid}.cwasm`)],{encoding:'utf8',timeout:30_000,maxBuffer:2<<20});
      await rm(join(tmpdir(),`wasm-fyi-component-${process.pid}.cwasm`),{force:true});
      if(result.status===0)outcomes.push({id:w.id,status:'verified',scope:'compile-only'});
      else throw Error(result.stderr || 'Component compile failed');
      continue;
    }
    let args,input;
    if(w.command) {
      directory=await mkdtemp(join(tmpdir(),'wasm-fyi-component-'));
      for(const [name,file] of Object.entries(w.command.files || {})) {
        if(name.includes('..')||name.startsWith('/'))throw Error('Unsafe fixture path');
        const data=file.path?await readFile(resolve(site,file.path)):Buffer.from(file.data || '', 'base64');
        if(digest(data)!==file.sha256)throw Error('Fixture digest differs');
        const path=join(directory,name);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,data);
      }
      input=w.command.stdin_file?await readFile(join(directory,w.command.stdin_file)):Buffer.from(w.command.stdin || '', 'base64');
      args=['run','--dir',directory+'::/','--env','LANG=C.UTF-8','--argv0',w.command.argv[0],artifact,...w.command.argv.slice(1)];
    } else args=['run','--invoke',`${w.export}(${w.args.join(',')})`,artifact];
    for(let repetition=0;repetition<3;repetition++) {
      const result=spawnSync('wasmtime',args,{input,timeout:30_000,maxBuffer:w.command?.output_limit_bytes || 2<<20});
      if(result.error)throw result.error;
      if(result.status!==(w.command?.exit_code || 0))throw Error(result.stderr.toString() || `Exit ${result.status}`);
      if(w.command) {if(digest(result.stdout)!==w.command.stdout_sha256)throw Error('Component command output differs');}
      else if(w.oracle.kind!=='exact_u64'||result.stdout.toString().trim()!==w.oracle.expected.map(String).join('\n'))throw Error('Component return value differs');
    }
    outcomes.push({id:w.id,status:'verified',repetitions:3});
  } catch(error){outcomes.push({id:w.id,status:'failed',reason:error.message});}
  finally {if(directory)await rm(directory,{recursive:true,force:true});}
}
await mkdir(join(site,'.wasmbench'),{recursive:true});
await writeFile(join(site,'.wasmbench/corpus-components-check.json'),JSON.stringify({schema:1,wasmtime:version,outcomes},null,2)+'\n');
for(const outcome of outcomes.filter(o=>o.status!=='verified'))console.log(outcome.status,outcome.id,outcome.reason);
console.log(`Component source corpus: ${outcomes.filter(o=>o.status==='verified').length} verified, ${outcomes.filter(o=>o.status==='unavailable').length} unavailable, ${outcomes.filter(o=>o.status==='failed').length} failed`);
if(outcomes.some(o=>o.status==='failed'))process.exitCode=1;
