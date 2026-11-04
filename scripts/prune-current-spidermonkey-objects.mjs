import {readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withBuildLock} from './lib/measurement-lock.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {historyBuildDirectory} from './lib/history-build-cache.mjs';
import {digest} from './lib/wasmbench.mjs';
const root=resolve(process.argv[2]),read=async path=>JSON.parse(await readFile(path,'utf8'));
await withBuildLock(root,async()=>{
 const pin=(await read(join(root,'source-plan.json'))).pins.find(pin=>pin.engine==='spidermonkey');
 const directory=await historyBuildDirectory(root,pin,'spidermonkey');
 if(execFileSync('ps',['-axo','command='],{encoding:'utf8'}).split('\n').some(command=>command.includes(directory)))throw Error('SpiderMonkey SDK still active');
 await runCommand(process.execPath,[join(import.meta.dirname,'audit-current-campaign.mjs'),root,'spidermonkey'],{cwd:import.meta.dirname});
 const audit=await read(join(root,'coverage-audit-selected.json'));
 if(!audit.complete||audit.engines.length!==1||audit.engines[0].revision!==pin.revision)throw Error('SpiderMonkey captures incomplete');
 const main=await read(join(directory,'spidermonkey-build.json')),feature=await read(join(directory,'spidermonkey-feature-binding.json'));
 const protectedFiles=new Set();
 for(const file of [...Object.keys(main.runtime.file_sha256||{}),main.env.WASMBENCH_SPIDERMONKEY,feature.env.WASMBENCH_SPIDERMONKEY])protectedFiles.add(await realpath(file));
 const identities=await Promise.all([...protectedFiles].map(async file=>[file,digest(await readFile(file))]));
 let removed=0;
 async function prune(path){
  for(const entry of await readdir(path,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error})){
   const file=join(path,entry.name);
   if(entry.isDirectory()&&entry.name!=='dist')await prune(file);
   else if(entry.isFile()&&/\.(?:o|a|rlib|rmeta)$/.test(entry.name)){
    if(protectedFiles.has(await realpath(file)))throw Error('Runtime input is a build object: '+file);
    await rm(file);removed++;
   }
  }
 }
 for(const target of ['spidermonkey-build','spidermonkey-feature-sdk'])await prune(join(directory,target,'obj'));
 for(const [file,sha] of identities)if(digest(await readFile(file))!==sha)throw Error('Runtime changed during pruning: '+file);
 const result={at:new Date().toISOString(),revision:pin.revision,removedObjectFiles:removed,retained:'Shell binaries, shared libraries, source, controllers, captures'};
 await writeFile(join(root,'spidermonkey-object-prune.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
});
