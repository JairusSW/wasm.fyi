import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {site,digest} from './lib/wasmbench.mjs';
import {proposalRuntimeIdentity} from './lib/proposal-validation.mjs';
const manifestPath=join(site,'corpora/features/host-proposals/manifest.json');
const manifest=JSON.parse(await readFile(manifestPath));
const outcomes=[];
for(const contract of manifest.contracts.filter(c=>c.performance)) {
 if(digest(await readFile(join(site,contract.source)))!==contract.sourceSha256)throw Error('Stale host proposal source: '+contract.id);
 const command=[...contract.performance.argv];if(command[0]==='node')command[0]=process.execPath;
 const p=spawnSync(command[0],command.slice(1),{cwd:site,encoding:'utf8',timeout:30000,maxBuffer:2<<20});
 let status=p.status===0?'verified':'failed',reason=p.error?.message;
 try {
  const result=JSON.parse(p.stdout.trim().split('\n').at(-1));
  if(contract.feature==='wasm-c-api') {
   const n=contract.performance.iterations;let expected=0;
   for(let i=0;i<n;i++)expected=(expected+(contract.name==='trap-lifecycle'?1:
    ['direct-call','host-callback'].includes(contract.name)?3*(i%256)+1:i%256))>>>0;
   if(result.checksum!==expected||result.operations!==n)throw Error('Native C checksum differs from independent JS oracle');
  } else if(result.status!=='verified'||result.case!==contract.name)throw Error('Missing native host verification result');
 }catch(error){status='failed';reason=error.message;}
 outcomes.push({id:contract.id,status,command,exitCode:p.status,signal:p.signal,reason,sourceSha256:contract.sourceSha256,
  artifactSha256:contract.sha256,stdout:p.stdout,stderr:p.stderr});
 console.log(status,contract.id);
}
if(!outcomes.length)throw Error('Empty host performance inventory');
const out=join(site,'.wasmbench/proposal-coverage');await mkdir(out,{recursive:true});
await writeFile(join(out,'host-performance-correctness.json'),JSON.stringify({schema:1,created:new Date().toISOString(),timing:false,
 node:await proposalRuntimeIdentity(process.execPath),manifestSha256:digest(await readFile(manifestPath)),outcomes},null,2)+'\n');
if(outcomes.some(o=>o.status!=='verified'))process.exitCode=1;
