import {createHash} from 'node:crypto';
import {readFile,writeFile,copyFile,rename,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function assertWazeroInterruptsDisabled(source) {
 if(source.includes('WithCloseOnContextDone(true)'))throw Error('Wazero context interruption must stay disabled for benchmark execution');
 if(source.includes('"context_termination": "enabled"')||source.includes('"context_termination":"enabled"'))throw Error('Wazero adapter metadata still claims context interruption is enabled');
}
export function disableWazeroInterrupts(source) {
 source=source.replaceAll('.WithCloseOnContextDone(true)','');
 source=source.replaceAll('"context_termination": "enabled"','"context_termination": "disabled"').replaceAll('"context_termination":"enabled"','"context_termination":"disabled"');
 assertWazeroInterruptsDisabled(source);return source;
}

// Restore files that existed in the frozen harness while retaining sampling
// support files introduced by the current collector.
export async function restoreHistoricalWazeroSources(root,base,version,{includeTests=true}={}) {
 const directory=join(root,'adapters/wazero'),frozen=join(base,'adapters/wazero');
 const restored=[];
 for(const entry of await readdir(directory)) {
  if(!entry.endsWith('.go')||(!includeTests&&entry.endsWith('_test.go')))continue;
  const source=join(frozen,entry);
  if(!await stat(source).catch(()=>null))continue;
  await writeFile(join(directory,entry),(await readFile(source,'utf8')).replaceAll('1.12.0',version));
  restored.push(entry);
 }
 return restored;
}

export async function applyWazeroSampling(root) {
 const path=join(root,'adapters/wazero/main.go');
 let source=disableWazeroInterrupts(await readFile(path,'utf8'));
 const begin='\t// Validate in this process outside measurement as well. Controller uses a separate';
 const finish='\twarmup := r.Warmup';
 const marker='\t// Every measured sample validates its own result or fresh instance outside timing.\n\t// Do not invoke the retained guest again between phase/sample groups.\n';
 if(!source.includes(marker)) {
  let first=source.indexOf(begin);
  if(first<0)first=source.indexOf('\t// Lifecycle validation stays outside timing. Steady validates every recorded');
  const last=source.indexOf(finish,first);
  if(first<0||last<0)throw Error('Wazero scalar validation seam changed');
  const block=source.slice(first,last);
  if(!block.includes('v, e := a.fn.Call(ctx, a.prep.Workload.Args...)')||!block.includes('if !a.verify(v)'))throw Error('Wazero scalar validation body changed');
  source=source.slice(0,first)+marker+source.slice(last);
 }
 await writeFile(path,source);
 await copyFile(fileURLToPath(new URL('../../adapters/wazero/sampling_test.go',import.meta.url)),join(root,'adapters/wazero/sampling_test.go'));
}

// Caller holds the host/project lease. Rebuild the adapter only against the
// already pinned module file; controller and runtime SDK sources stay unchanged.
export async function rebuildWazeroSampling({root,env,run}) {
 const module=join(root,'weekly-wazero.mod');
 if(!await stat(module).catch(()=>null))throw Error('Pinned Wazero module file unavailable');
 const file=join(root,'adapters/wazero/main.go'),binary=join(root,'bin/adapter-wazero');
 assertWazeroInterruptsDisabled(await readFile(file,'utf8'));
 const hash=b=>createHash('sha256').update(b).digest('hex'),receiptPath=join(root,'wazero-fresh-lifecycle.json');
 const previous=await readFile(receiptPath,'utf8').then(JSON.parse,()=>null);
 if(previous?.sourceSha256===hash(await readFile(file))&&previous?.binarySha256===hash(await readFile(binary)))return previous;
 await copyFile(file,file+'.before-fresh-lifecycle');
 await copyFile(binary,binary+'.before-fresh-lifecycle');
 await applyWazeroSampling(root);
 await run('go',['build','-mod=mod','-modfile='+module,'-trimpath','-o',binary+'.fresh-lifecycle','./adapters/wazero'],{cwd:root,env});
 await run('git',['add','adapters/wazero/main.go','adapters/wazero/sampling_test.go'],{cwd:root,env});
 await run('git',['-c','user.name=wasmfyi benchmark harness','-c','user.email=benchmark@localhost','commit','--allow-empty','-m','Validate fresh Wazero samples without repeated prior-instance calls'],{cwd:root,env});
 await rename(binary+'.fresh-lifecycle',binary);
 const receipt={policy:'fresh-lifecycle-without-prior-instance-call-v1',sourceSha256:hash(await readFile(file)),binarySha256:hash(await readFile(binary)),moduleSha256:hash(await readFile(module)),at:new Date().toISOString()};
 await writeFile(receiptPath,JSON.stringify(receipt,null,2));return receipt;
}
