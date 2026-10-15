import {readFile,readdir,stat,realpath} from 'node:fs/promises';
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
 // Each receipt lives beside its own adapter harness. receipt.root may instead
 // name the upstream SDK shared with another configuration; never prune it.
 const ownHarness=join(directory,'harness');
 const recorded=typeof receipt.root==='string'?resolve(receipt.root):'';
 const harness=receiptName!=='binding.json'&&(recorded===ownHarness||recorded.startsWith(ownHarness+'/'))?recorded:ownHarness;
 const canonical=await realpath(harness).catch(()=>null),canonicalRoot=await realpath(root);
 if(!canonical||!['engine-builds','sdk-builds'].some(group=>canonical.startsWith(join(canonicalRoot,group)+'/'))||!(await stat(harness)).isDirectory())throw Error('Unexpected build receipt path: '+directory+' -> '+harness);
 if(processes.includes(harness)||processes.includes(directory)){live++;continue;}
 await pruneRustIntermediates(harness);pruned++;
}
console.log(JSON.stringify({prunedBuilds:pruned,activeBuildsPreserved:live}));
