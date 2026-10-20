import {readFile,readdir,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {site,digest} from './wasmbench.mjs';
import {proposalD8,proposalRuntimeIdentity} from './proposal-validation.mjs';

export const upstreamRoot=join(site,'.wasmbench/proposal-coverage/upstream');
export const proposalSuites=[
 {id:'wasmtime',repository:'bytecodealliance/wasmtime',revision:'823d1b8f251494a06288194d0df746191f535ff7',archiveSha256:'ebe701bbb0a7a7508f22b906ed423e3554b5b9541bcc7a51cc84f271c0843009',directory:'tests/misc_testsuite',extension:'.wast',license:'Apache-2.0 WITH LLVM-exception'},
 {id:'spec',repository:'WebAssembly/testsuite',revision:'0dc0343c9876267d99a7577ed4fc2289406a7869',archiveSha256:'3e3496b6ad6dc86ac34142405f0545fe3312417ac559917354dac4b83151579f',directory:'.',extension:'.wast',license:'Apache-2.0',relationship:'Wasmtime v46.0.1 tests/spec_testsuite submodule'},
 {id:'component',repository:'WebAssembly/component-model',revision:'694d789e46eaa8c52bfbc93871e2190a9f8afc60',archiveSha256:'2b903576cf7518ebf3fa9c54c344b16a858c9851ca661296635d5dd702eeb660',directory:'test',extension:'.wast',license:'Apache-2.0',relationship:'Wasmtime v46.0.1 tests/component-model submodule'},
 {id:'v8-15.2.20',repository:'v8/v8',revision:'34f4bf16f621ceba505ef2b7b818d48d09a5d3d3',archiveSha256:'950d66851973673e5c92dc6d0ec1e9df6a3e9bd007a5aa71b3964b69585f910c',directory:'test/mjsunit/wasm',extension:'.js,.mjs',license:'BSD-3-Clause'},
];

export async function filesBelow(root,extensions,relative='') {
 const rows=[];
 for(const entry of (await readdir(join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
  const path=join(relative,entry.name);
  if(entry.isDirectory())rows.push(...await filesBelow(root,extensions,path));
  else if(extensions.some(ext=>entry.name.endsWith(ext)))rows.push({path:path.replaceAll('\\','/'),sha256:digest(await readFile(join(root,path)))});
 }
 return rows;
}

export async function prepareProposalSuite(pin) {
 await mkdir(upstreamRoot,{recursive:true});
 const archive=join(upstreamRoot,pin.id+'.tar.gz'),root=join(upstreamRoot,pin.id);
 let bytes;
 try {bytes=await readFile(archive);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const response=await fetch(`https://codeload.github.com/${pin.repository}/tar.gz/${pin.revision}`);
  if(!response.ok)throw Error('Cannot fetch '+pin.id+': '+response.status);
  bytes=Buffer.from(await response.arrayBuffer());await writeFile(archive,bytes);
 }
 if(digest(bytes)!==pin.archiveSha256)throw Error('Upstream archive digest mismatch: '+pin.id);
 // Always extract a fresh copy: the source tree is never an unchecked cache.
 await rm(root,{recursive:true,force:true});
 await mkdir(root,{recursive:true});
 const unpack=spawnSync('tar',['-xzf',archive,'--strip-components=1','-C',root],{encoding:'utf8'});
 if(unpack.status!==0)throw Error('Cannot extract '+pin.id+': '+unpack.stderr);
 const files=await filesBelow(join(root,pin.directory),pin.extension.split(','));
 if(!files.length)throw Error('Empty upstream inventory: '+pin.id);
 return {...pin,files};
}

// This follows test-util/src/{wast,wasmtime_wast}.rs's per-file proposal
// configuration. Backend/allocator/collector matrices remain the Rust runner's
// responsibility; the CLI lane is a complete WAST-file inventory, not that matrix.
const wasmOptions=['bulk_memory','memory64','custom_page_sizes','multi_memory','threads','shared_everything_threads',
 'gc','function_references','relaxed_simd','reference_types','tail_call','extended_const','wide_arithmetic','branch_hinting',
 'component_model_async','component_model_more_async_builtins','component_model_async_stackful','component_model_threading',
 'component_model_error_context','component_model_gc','component_model_map','component_model_fixed_length_lists','component_model_implements',
 'simd','exceptions','stack_switching'];
export function wasmtimeTestFlags(suite,path,text) {
 const c={};
 if(suite==='wasmtime')for(const m of text.matchAll(/^;;!\s*(\w+)\s*=\s*(true|false)\s*$/gm))c[m[1]]=m[2]==='true';
 else if(suite==='spec') {
  c.bulk_memory=true;
  const proposal=/^proposals\/([^/]+)\//.exec(path)?.[1];
  if(proposal==='threads')c.threads=true;
  else if(proposal==='custom-page-sizes')Object.assign(c,{custom_page_sizes:true,multi_memory:true,memory64:true,reference_types:true});
  else if(proposal==='wide-arithmetic')c.wide_arithmetic=true;
  else if(!proposal)Object.assign(c,{reference_types:true,simd:true,relaxed_simd:true,multi_memory:true,gc:true,memory64:true,tail_call:true,extended_const:true,exceptions:true});
  if(proposal==='custom-descriptors')c.custom_descriptors=true;
  if(path.startsWith('legacy/'))c.legacy_exceptions=true;
 } else {
  Object.assign(c,{reference_types:true,multi_memory:true,component_model_implements:true});
  if(path.startsWith('async/')||['resources.wast','multiple-resources.wast','trap-in-post-return.wast'].includes(path.split('/').at(-1)))
   Object.assign(c,{component_model_async:true,component_model_async_stackful:true,component_model_more_async_builtins:true,component_model_threading:true});
  if(path.startsWith('wasm-tools/'))Object.assign(c,{memory64:true,threads:true,exceptions:true,gc:true});
  if(path.startsWith('wasmtime/'))Object.assign(c,{exceptions:true,gc:true});
 }
 c.function_references=!!(c.function_references||c.gc);
 c.reference_types=!!(c.reference_types||c.function_references);
 c.simd=!!(c.simd||c.relaxed_simd);
 c.exceptions=!!(c.exceptions||c.stack_switching);
 const flags=wasmOptions.flatMap(option=>['-W',option.replaceAll('_','-')+'='+!!c[option]]);
 if(c.nan_canonicalization)flags.push('-W','nan-canonicalization=true');
 if(suite!=='wasmtime')flags.push('--ignore-error-messages');
 return {flags,unavailableConfiguration:Object.entries(c).filter(([key,value])=>value&&['legacy_exceptions','custom_descriptors'].includes(key)).map(([key])=>key)};
}

export function v8TestArguments(path,text) {
 const flags=[...text.matchAll(/^\/\/\s*Flags:(.*)$/gm)].flatMap(m=>m[1].trim().split(/\s+/).filter(Boolean));
 const files=[...text.matchAll(/^\/\/\s*Files:(.*)$/gm)].flatMap(m=>m[1].trim().split(/\s+/).filter(Boolean));
 const env=Object.fromEntries([...text.matchAll(/^\/\/\s*Environment Variables:(.*)$/gm)].flatMap(m=>m[1].trim().split(/\s+/).filter(Boolean)).map(pair=>{const at=pair.indexOf('=');if(at<1)throw Error('Invalid V8 environment directive');return [pair.slice(0,at),pair.slice(at+1)];}));
 return {args:['--allow-natives-syntax',...flags,...(/^\/\/ NO HARNESS$/m.test(text)?[]:['test/mjsunit/mjsunit.js']),...files,path],env};
}

export async function runProposalSuite(suite,{out,timeout=120000}={}) {
 const root=join(upstreamRoot,suite.id),directory=join(root,suite.directory);
 const binary=suite.id.startsWith('v8')?proposalD8():process.env.WASMBENCH_WASMTIME||'wasmtime';
 const engine=await proposalRuntimeIdentity(binary);
 if(suite.id.startsWith('v8')&&!/15\.2\.20\b/.test(engine.version))throw Error('Matching V8 15.2.20 required');
 if(!suite.id.startsWith('v8')&&!/wasmtime 46\.0\.1\b/.test(engine.version))throw Error('Matching Wasmtime 46.0.1 required');
 const results=[];
 for(const file of suite.files) {
  const bytes=await readFile(join(directory,file.path));
  if(digest(bytes)!==file.sha256)throw Error('Upstream source changed: '+file.path);
  let args,env={},configuration;
  if(suite.id.startsWith('v8'))({args,env}=v8TestArguments(join(suite.directory,file.path),bytes.toString()));
  else {configuration=wasmtimeTestFlags(suite.id,file.path,bytes.toString());args=['wast','--wasmtime-builtins',...configuration.flags,join(directory,file.path)];}
  const start=Date.now();
  const p=spawnSync(binary,args,{cwd:root,env:{...process.env,...env},encoding:'utf8',timeout,maxBuffer:8<<20});
  const output=(p.stdout||'')+(p.stderr||'');
  const status=p.error?'runner-error':p.signal?'crashed':p.status===0?'passed':'failed';
  results.push({...file,status,exitCode:p.status,signal:p.signal,error:p.error?.message,elapsedMs:Date.now()-start,args,configuration,
   outputSha256:digest(output),...(status!=='passed'?{output:output.slice(-24000),outputTruncated:output.length>24000}:{})});
  if(results.length%25===0)console.log(suite.id,results.length+'/'+suite.files.length);
  if(out)await writeFile(out,JSON.stringify({suite:{...suite,files:undefined},engine,results},null,2)+'\n');
 }
 return {suite:{...suite,files:undefined},engine,results};
}
