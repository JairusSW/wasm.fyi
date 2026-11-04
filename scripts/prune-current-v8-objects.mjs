import {readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withBuildLock} from './lib/measurement-lock.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {historyBuildDirectory} from './lib/history-build-cache.mjs';
import {digest} from './lib/wasmbench.mjs';
const root=resolve(process.argv[2]),read=async path=>JSON.parse(await readFile(path,'utf8'));
await withBuildLock(root,async()=>{
 const plan=await read(join(root,'source-plan.json')),pin=plan.pins.find(pin=>pin.engine==='v8');
 if(!pin)throw Error('V8 source pin absent');
 const directory=await historyBuildDirectory(root,pin,'v8'),receipt=await read(join(directory,'v8-build.json'));
 const binary=await realpath(receipt.env.WASMBENCH_NODE),output=dirname(binary);
 if(!output.endsWith('/sources/v8/out/Release')||receipt.pin.revision!==pin.revision||digest(await readFile(binary))!==receipt.provenance.nodeSha256)throw Error('Pinned Node SDK identity changed');
 if(execFileSync('ps',['-axo','command='],{encoding:'utf8'}).split('\n').some(command=>command.includes(output)))throw Error('Node SDK still active');
 await runCommand(process.execPath,[join(import.meta.dirname,'audit-current-campaign.mjs'),root,'v8'],{cwd:import.meta.dirname});
 const audit=await read(join(root,'coverage-audit-selected.json'));
 if(!audit.complete||audit.engines.length!==1||audit.engines[0].revision!==pin.revision)throw Error('V8 captures are incomplete');
 const targets=(await readdir(output,{withFileTypes:true})).filter(entry=>entry.isDirectory()&&/^obj(?:\..+)?$/.test(entry.name)).map(entry=>join(output,entry.name));
 for(const file of Object.keys(receipt.runtime.file_sha256||{})){
  const actual=await realpath(file);
  if(targets.some(target=>actual===target||actual.startsWith(target+sep)))throw Error('Runtime depends on build objects: '+actual);
 }
 for(const target of targets)await rm(target,{recursive:true});
 if(digest(await readFile(binary))!==receipt.provenance.nodeSha256)throw Error('Node SDK changed during object pruning');
 const result={at:new Date().toISOString(),removed:targets,revision:pin.revision,nodeSha256:receipt.provenance.nodeSha256,retained:'All captures, SDK executable, runtime libraries and source'};
 await writeFile(join(root,'v8-object-prune.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
});
