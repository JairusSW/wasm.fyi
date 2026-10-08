import {readFile,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pruneRustIntermediates} from './lib/prune-build-cache.mjs';
const root=resolve(process.argv[2]),processes=execFileSync('ps',['-axo','args='],{encoding:'utf8',maxBuffer:8*1024*1024});
let pruned=0,live=0;
for(const group of ['engine-builds','sdk-builds'])for(const name of await readdir(join(root,group)).catch(()=>[])) {
 const directory=join(root,group,name),entries=await readdir(directory).catch(()=>[]);
 const receiptName=entries.find(file=>file==='binding.json'||file.endsWith('-build.json'));
 if(!receiptName)continue;
 const receipt=JSON.parse(await readFile(join(directory,receiptName),'utf8'));
 // Binding roots identify the upstream SDK source, sometimes shared by two
 // backends. Adapter intermediates belong to this build's own harness.
 const harness=receiptName==='binding.json'?join(directory,'harness'):receipt.root||join(directory,'harness');
 if((!harness.startsWith(join(root,'engine-builds')+'/')&&!harness.startsWith(join(root,'sdk-builds')+'/'))||!await stat(harness).catch(()=>null))throw Error('Unexpected build receipt path: '+directory+' -> '+harness);
 if(processes.includes(harness)||processes.includes(directory)){live++;continue;}
 await pruneRustIntermediates(harness);pruned++;
}
console.log(JSON.stringify({prunedBuilds:pruned,activeBuildsPreserved:live}));
