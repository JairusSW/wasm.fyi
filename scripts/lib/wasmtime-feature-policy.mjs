import {readFile,writeFile,mkdir,cp,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {digest} from './wasmbench.mjs';
import {atomicJSON} from './benchmark-plan.mjs';
import {runCommand} from './benchmark-process.mjs';
import {createSDKBuildBudget} from './sdk-build-budget.mjs';

export const WASMTIME_FEATURE_POLICY='wasmtime-core-proposals-v2';
export const WASMTIME_FEATURE_REVISION='ebe5e8df1f4e12c5fc2f5954926881d8d61367d8';
export const wasmtimeActivatedProposals=Object.freeze(['gc','typed-function-references','exceptions','threads','stack-switching','compact-imports','custom-page-sizes','wide-arithmetic','branch-hinting']);
export function wasmtimeProposalsForBackend(engine,architecture=process.arch){
 if(engine==='wasmtime')return wasmtimeActivatedProposals.filter(feature=>feature!=='stack-switching'||architecture==='x64'||architecture==='amd64');
 if(engine==='wasmtime-winch')return ['exceptions','compact-imports','custom-page-sizes','wide-arithmetic',...(['x64','amd64'].includes(architecture)?['threads']:[])];
 return [];
}

// v50 Config::compiler_panicking_wasm_features is the backend/ISA boundary.
// Legacy EH is absent from this revision's known feature set. ARM64 Winch's
// partial SIMD lowering stays disabled, matching the existing declared policy.
export function withWasmtimeCoreProposals(source){
 if(source.includes(WASMTIME_FEATURE_POLICY))return source;
 const start=source.indexOf('fn policy(winch: bool)'),end=source.indexOf('\npub fn configure(',start);
 if(start<0||end<0||!source.includes('WasmFeatures::GC'))throw Error('Wasmtime feature-policy source seam changed');
 const policy=`// ${WASMTIME_FEATURE_POLICY}
fn policy(winch: bool) -> Vec<(&'static str, WasmFeatures, bool)> {
    vec![
        ("TAIL_CALL", WasmFeatures::TAIL_CALL, !winch),
        ("RELAXED_SIMD", WasmFeatures::RELAXED_SIMD, !winch),
        ("GC", WasmFeatures::GC, !winch),
        ("GC_TYPES", WasmFeatures::GC_TYPES, true),
        ("FUNCTION_REFERENCES", WasmFeatures::FUNCTION_REFERENCES, !winch),
        ("EXCEPTIONS", WasmFeatures::EXCEPTIONS, true),
        ("LEGACY_EXCEPTIONS", WasmFeatures::LEGACY_EXCEPTIONS, false),
        ("THREADS", WasmFeatures::THREADS, !winch || cfg!(target_arch = "x86_64")),
        ("STACK_SWITCHING", WasmFeatures::STACK_SWITCHING, !winch && cfg!(all(target_arch = "x86_64", unix))),
        ("COMPACT_IMPORTS", WasmFeatures::COMPACT_IMPORTS, true),
        ("CUSTOM_PAGE_SIZES", WasmFeatures::CUSTOM_PAGE_SIZES, true),
        ("WIDE_ARITHMETIC", WasmFeatures::WIDE_ARITHMETIC, true),
        ("SIMD", WasmFeatures::SIMD, !(winch && cfg!(target_arch = "aarch64"))),
        ("CM_ASYNC", WasmFeatures::CM_ASYNC, false),
        ("CM_ASYNC_STACKFUL", WasmFeatures::CM_ASYNC_STACKFUL, false),
    ]
}
`;
 source=source.slice(0,start)+policy+source.slice(end);
 const configure='pub fn configure(config: &mut Config, winch: bool) {';
 source=source.replace(configure,configure+'\n    config.wasm_branch_hinting(!winch);\n    config.gc_support(true);\n    config.shared_memory(!winch || cfg!(target_arch = "x86_64"));');
 const describe='        "namespace": "wasmparser/0.251.0",';
 if(!source.includes(describe))throw Error('Wasmtime feature-description seam changed');
 return source.replace(describe,describe+'\n        "branch_hinting": !winch,\n        "policy": "'+WASMTIME_FEATURE_POLICY+'",').replace('assert_eq!(describe(winch)["supported"]["EXCEPTIONS"], json!(!winch));','assert_eq!(describe(winch)["supported"]["EXCEPTIONS"], json!(true));');
}

export function withWasmtimeFeatureCrates(source,{architecture=process.arch}={}){
 const line=/^wasmtime = \{[^\n]+features = \[([^\]]*)\][^\n]*\}/m;
 const match=source.match(line);if(!match)throw Error('Wasmtime source dependency seam changed');
 // Preserve an existing copying-collector build, but do not introduce it into
 // the previously DRC-only configurations whose valid results we retain.
 const features=['gc','gc-drc','gc-null','threads',...(architecture==='x64'?['stack-switching']:[])];
 const current=match[1],added=features.filter(feature=>!current.includes('"'+feature+'"'));
 return source.replace(line,match[0].replace('features = ['+current+']','features = ['+current+(current.trim()&&added.length?', ':'')+added.map(feature=>JSON.stringify(feature)).join(', ')+']'));
}

// Caller holds the campaign's build lease. This clone gets its own adapter,
// Cargo target and controller; the main harness, binaries and captures stay intact.
export async function ensureWasmtimeFeatureBinding(directory,receipt,qualifiedEnv={},options={}){
 if(receipt.pin?.repository!=='bytecodealliance/wasmtime'||receipt.pin.revision!==WASMTIME_FEATURE_REVISION)throw Error('Wasmtime core feature policy needs a source audit for this revision');
 const path=join(directory,'wasmtime-feature-binding.json');
 const cached=await readFile(path,'utf8').then(JSON.parse,()=>null);
 const baselineSource=await readFile(join(receipt.root,'adapters/wasmtime/src/features.rs'),'utf8');
 const baselineBranchHints=/config\.wasm_branch_hinting\((?:!winch|true)\)/.test(baselineSource);
 if(cached?.policy===WASMTIME_FEATURE_POLICY&&cached.revision===receipt.pin.revision&&(!options.inputs||cached.qualified&&['gc','threads','exceptions'].every(feature=>cached.qualificationProbes?.includes(feature)))&&await stat(cached.adapter).catch(()=>null)&&digest(await readFile(cached.adapter))===cached.adapterSha256&&await stat(cached.controller).catch(()=>null)&&digest(await readFile(cached.controller))===cached.controllerSha256){
  if(cached.baselineBranchHints!==baselineBranchHints){cached.baselineBranchHints=baselineBranchHints;await atomicJSON(path,cached)}
  return cached;
 }
 const original=receipt.root,root=join(directory,'feature-harness'),controller=join(directory,'wasmtime-feature-controller');
 const mainAdapter=join(original,'adapters/wasmtime/target/release/adapter-wasmtime'),mainHash=digest(await readFile(mainAdapter));
 const env={...process.env,...qualifiedEnv,...receipt.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
 for(const key of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete env[key];
 if(env.WASMFYI_BUILD_JOBS)env.CARGO_BUILD_JOBS=env.WASMFYI_BUILD_JOBS;
 const budget=createSDKBuildBudget(env),log=join(directory,'wasmtime-feature-build.log');
 const run=(program,args,settings={})=>runCommand(program,args,{cwd:root,env,log,signal:budget.signal,...settings});
 try{
  if(!await stat(join(root,'.git')).catch(()=>null))await run('git',['clone','--no-hardlinks',original,root],{cwd:directory});
  // SDK preparation can leave source-bound dependency paths uncommitted.
  const tracked=(await run('git',['ls-files','-z'],{cwd:original})).output.split('\0').filter(Boolean);
  for(const name of tracked){await mkdir(dirname(join(root,name)),{recursive:true});await cp(join(original,name),join(root,name),{force:true})}
  const analyzer='adapters/wasmtime/src/bin/wasm-analyze.rs';
  await mkdir(dirname(join(root,analyzer)),{recursive:true});await cp(join(original,analyzer),join(root,analyzer));
  await cp(join(original,'corpus/testdata'),join(root,'corpus/testdata'),{recursive:true,force:true});
  await cp(join(original,'adapters/wasmtime/Cargo.lock'),join(root,'adapters/wasmtime/Cargo.lock'));
  const manifest=join(root,'adapters/wasmtime/Cargo.toml'),features=join(root,'adapters/wasmtime/src/features.rs'),main=join(root,'adapters/wasmtime/src/main.rs');
  await writeFile(manifest,withWasmtimeFeatureCrates(await readFile(manifest,'utf8')));
  await writeFile(features,withWasmtimeCoreProposals(await readFile(features,'utf8')));
  const before=await readFile(main,'utf8');if(!before.includes('wasmtime-default-subset-v1'))throw Error('Wasmtime description policy seam changed');
  await writeFile(main,before.replaceAll('wasmtime-default-subset-v1',WASMTIME_FEATURE_POLICY));
  if(options.inputs){
   const workloads=JSON.parse(await readFile(join(options.inputs,'compatibility.json'),'utf8'));
   const proofs=[
    workloads.find(w=>w.id==='features/gc/struct-allocation-access/64'),
    workloads.find(w=>w.id==='features/threads/atomic-compare-exchange/64'),
    workloads.find(w=>w.id==='features/exceptions/throw-catch-tag/64'),
   ];
   if(proofs.some(w=>!w||w.hostProfile||w.oracle?.kind!=='exact_u64'))throw Error('Wasmtime qualification probes unavailable');
   let tests='\n#[cfg(test)]\nmod core_proposals_source_proofs {\n use crate::Adapter;\n use wasmtime::{Module,Store,Instance,Val,ValType};\n';
   for(let index=0;index<proofs.length;index++){
    const w=proofs[index],filename='wasmfyi-proposal-proof-'+index+'.wasm';
    if(digest(await readFile(join(options.inputs,w.artifact)))!==w.sha256)throw Error('Wasmtime qualification artifact differs from its frozen hash');
    await cp(join(options.inputs,w.artifact),join(root,'adapters/wasmtime/src',filename));
    tests+=` #[test] fn probe_${index}() {
      for winch in [false,true] {
       if winch && ${index===0?'true':index===1?'!cfg!(target_arch = "x86_64")':'false'} { continue; }
       let adapter=Adapter {prep:None,bytes:vec![],winch};
       let engine=adapter.engine().unwrap();
       let module=Module::new(&engine,include_bytes!("${filename}")).unwrap();
       let mut store=Store::new(&engine,());
       let instance=Instance::new(&mut store,&module,&[]).unwrap();
       let function=instance.get_func(&mut store,${JSON.stringify(w.export)}).unwrap();
       let inputs=[${w.args.map(arg=>String(arg)+'u64').join(',')}];
       let args:Vec<Val>=function.ty(&store).params().enumerate().map(|(i,t)|match t {ValType::I32=>Val::I32(inputs[i] as i32),ValType::I64=>Val::I64(inputs[i] as i64),_=>panic!("non-scalar probe parameter")}).collect();
       let mut results:Vec<Val>=function.ty(&store).results().map(|t|match t {ValType::I32=>Val::I32(0),ValType::I64=>Val::I64(0),_=>panic!("non-scalar probe result")}).collect();
       function.call(&mut store,&args,&mut results).unwrap();
       assert_eq!(results.len(),1);
       let result=match results[0] {Val::I32(x)=>x as u32 as u64,Val::I64(x)=>x as u64,_=>panic!("non-scalar probe result")};
       assert_eq!(result,${w.oracle.expected[0]}u64);
      }
     }\n`;
   }
   await writeFile(features,(await readFile(features,'utf8'))+tests+'}\n');
  }
  const target=join(root,'adapters/wasmtime/target');
  await run('cargo',['build','--release','--locked','--bin','adapter-wasmtime','--manifest-path',manifest,'--target-dir',target]);
  if(options.inputs)await run('cargo',['test','--release','--locked','--bin','adapter-wasmtime','--manifest-path',manifest,'--target-dir',target,'features::','--','--test-threads=1']);
  const analyzerBinary='adapters/wasmtime/target/release/wasm-analyze';
  await cp(join(original,analyzerBinary),join(root,analyzerBinary));
  await run('go',['build','-trimpath','-o',controller,'./cmd/wasmbench']);
  const adapter=join(root,'adapters/wasmtime/target/release/adapter-wasmtime');
  if(digest(await readFile(mainAdapter))!==mainHash)throw Error('Main Wasmtime adapter changed during isolated feature build');
  const binding={policy:WASMTIME_FEATURE_POLICY,revision:receipt.pin.revision,root,controller,controllerSha256:digest(await readFile(controller)),adapter,adapterSha256:digest(await readFile(adapter)),mainAdapterSha256:mainHash,baselineBranchHints,collector:(await readFile(manifest,'utf8')).includes('"gc-copying"')?'copying':'drc',proposals:wasmtimeActivatedProposals,qualified:!!options.inputs,qualificationProbes:options.inputs?['gc','threads','exceptions']:[],env:receipt.env,builtAt:new Date().toISOString()};
  await atomicJSON(path,binding);return binding;
 }finally{budget.dispose()}
}
