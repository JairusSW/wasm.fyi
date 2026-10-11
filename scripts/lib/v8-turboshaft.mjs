import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
export function selectV8TurboshaftPolicy(options,compilerSource='') {
 if(/^\s*--turboshaft-wasm(?=\s|\()/m.test(options))return 'explicit-flag';
 if(compilerSource.includes('ExecuteTurboshaftWasmCompilation(')&&!compilerSource.includes('ExecuteTurbofanWasmCompilation(')&&!compilerSource.includes('v8_flags.turboshaft_wasm'))return 'mandatory-source-default';
 throw Error('Pinned V8 Turboshaft pipeline is not established');
}
export async function applyV8Turboshaft(root){
 const runner=join(root,'experiment/runner.go');let s=await readFile(runner,'utf8');
 if(!s.includes('WASMBENCH_V8_TURBOSHAFT_POLICY')){
  const seam='r.Command = append(r.Command, "--allow-natives-syntax", "--no-liftoff", "--no-wasm-tier-up", "--no-wasm-lazy-compilation")';
  if(!s.includes(seam))throw Error('V8 optimizing runner seam changed');
  s=s.replace(seam,seam+`\n                tsPolicy := os.Getenv("WASMBENCH_V8_TURBOSHAFT_POLICY")
                if tsPolicy == "explicit-flag" { r.Command = append(r.Command,"--turboshaft-wasm") } else if tsPolicy != "" && tsPolicy != "mandatory-source-default" { return nil,fmt.Errorf("invalid V8 Turboshaft policy %q",tsPolicy) }`);await writeFile(runner,s);
 }
 const parser=join(root,'adapters/v8/compiler-mode.mjs');s=await readFile(parser,'utf8');
 if(!s.includes('const turboshaftRequested=')){
  const seam='const mode=argv[0].slice';let pos=s.indexOf(seam);if(pos<0)throw Error('V8 parser seam changed');
  // Strip exactly one pipeline flag for the existing strict ordered tier/cache
  // parser; all other flags and their order remain checked unchanged.
  s=s.slice(0,pos)+`if(argv[0]!=='--compiler-mode=optimizing-only'&&flags.includes('--turboshaft-wasm'))throw Error('Turboshaft requires optimizing-only');
  const turboshaftRequested=flags.includes('--turboshaft-wasm');
  if(turboshaftRequested){const expectedAt=flags.includes('--single-threaded')?7:4;if(flags[expectedAt]!=='--turboshaft-wasm'||flags.filter(f=>f==='--turboshaft-wasm').length!==1)throw Error('invalid Turboshaft flag position');flags=flags.filter(f=>f!=='--turboshaft-wasm');}
  `+s.slice(pos);await writeFile(parser,s);
 }
 const adapter=join(root,'adapters/v8/adapter.mjs');s=await readFile(adapter,'utf8');
 if(!s.includes('wasm_compiler_policy')){
  const old="backend: compilerMode==='production-default'?'production-default-tiering':compilerMode";
  if(!s.includes(old))throw Error('V8 description backend seam changed');
  s=s.replace(old,"backend: compilerMode==='optimizing-only'&&(process.execArgv.includes('--turboshaft-wasm')||process.env.WASMBENCH_V8_TURBOSHAFT_POLICY==='mandatory-source-default')?'turboshaft':compilerMode==='production-default'?'production-default-tiering':compilerMode");
  const seam='configuration.compiler_mode=configuration.tiering=compilerMode;';
  if(!s.includes(seam))throw Error('V8 description configuration seam changed');
  s=s.replace(seam,seam+`\n  if(compilerMode==='optimizing-only'&&(process.execArgv.includes('--turboshaft-wasm')||process.env.WASMBENCH_V8_TURBOSHAFT_POLICY==='mandatory-source-default')){configuration.wasm_compiler='turboshaft';configuration.wasm_compiler_policy=process.execArgv.includes('--turboshaft-wasm')?'explicit-flag':'mandatory-source-default';}`);await writeFile(adapter,s);
 }
 const native=join(root,'adapters/v8/native-size.mjs');if(await stat(native).catch(()=>null)){
  s=await readFile(native,'utf8');if(!s.includes('WASMBENCH_V8_TURBOSHAFT_POLICY')){
   const seam="'--no-wasm-lazy-compilation',selected";
   if(!s.includes(seam))throw Error('V8 native policy seam changed');
   s=s.replace(seam,"'--no-wasm-lazy-compilation',...(process.env.WASMBENCH_V8_TURBOSHAFT_POLICY==='explicit-flag'?['--turboshaft-wasm']:[]),selected");await writeFile(native,s);
  }
 }
}
