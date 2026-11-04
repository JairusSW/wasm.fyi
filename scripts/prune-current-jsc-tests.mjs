import {readFile,realpath,writeFile,lstat,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withBuildLock} from './lib/measurement-lock.mjs';
import {historyBuildDirectory} from './lib/history-build-cache.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {digest} from './lib/wasmbench.mjs';
const root=resolve(process.argv[2]),read=async p=>JSON.parse(await readFile(p,'utf8'));
await withBuildLock(root,async()=>{
 const pin=(await read(join(root,'source-plan.json'))).pins.find(p=>p.engine==='jsc');
 const directory=await historyBuildDirectory(root,pin,'jsc');
 if(execFileSync('ps',['-axo','command='],{encoding:'utf8'}).split('\n').some(p=>p.includes(directory)))throw Error('JSC SDK still active');
 await runCommand(process.execPath,[join(import.meta.dirname,'audit-current-campaign.mjs'),root,'jsc'],{cwd:import.meta.dirname});
 const audit=await read(join(root,'coverage-audit-selected.json'));
 if(!audit.complete||audit.engines.length!==1||audit.engines[0].revision!==pin.revision)throw Error('JSC captures incomplete');
 const receipt=await read(join(directory,'jsc-build.json'));
 const native=join(directory,'jsc-build/native-source');
 const git=args=>execFileSync('git',['-C',native,...args],{encoding:'utf8'}).trim();
 if(git(['rev-parse','HEAD'])!==pin.revision)throw Error('JSC measurement worktree pin changed');
 const files=new Set(Object.keys(receipt.runtime.file_sha256||{}));
 for(const file of ['wasm/WasmCalleeGroup.h','wasm/WasmModule.h','wasm/WasmModule.cpp','jsc.cpp'])files.add(join(native,'Source/JavaScriptCore',file));
 const identities=await Promise.all([...files].map(async p=>[await realpath(p),digest(await readFile(p))]));
 // Git refuses narrowing an instrumented (intentionally modified) worktree.
 // Remove only these unused upstream test/web trees; leave its index and all
 // measurement patches intact. Git objects retain the omitted contents.
 const removed=[];
 for(const name of ['LayoutTests','Websites','JSTests','PerformanceTests','ManualTests','WebDriverTests']){
  const path=join(native,name),info=await lstat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e});
  if(!info)continue;
  if(!info.isDirectory()||await realpath(path)!==path)throw Error('Unexpected test tree symlink');
  await rm(path,{recursive:true});removed.push(name);
 }
 if(git(['rev-parse','HEAD'])!==pin.revision)throw Error('JSC pin changed');
 for(const [file,sha] of identities)if(digest(await readFile(file))!==sha)throw Error('JSC runtime or measurement source changed: '+file);
 const result={at:new Date().toISOString(),revision:pin.revision,policy:'remove-unused-measurement-test-trees',removed,protectedFiles:identities.length,retained:'All captures, databases, binaries, libraries, compiler, instrumented source and Git objects'};
 await writeFile(join(root,'jsc-test-tree-prune.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
});
