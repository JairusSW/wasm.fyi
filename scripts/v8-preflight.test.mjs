import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateV8Description} from './lib/v8-preflight.mjs';

const pin={version:'26.4.0',v8:'14.6.202.34-node.21'};
function description(mode) {
  const flags=['--allow-natives-syntax',mode==='liftoff-only'?'--liftoff-only':'--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation'];
  if(mode==='optimizing-wasmfx-only')flags.push('--experimental-wasm-wasmfx');
  return {build:'v'+pin.version,runtime_version:pin.v8,backend:mode,effective_configuration:{
    lazy_compilation:'disabled',tiering:mode,flags:JSON.stringify(flags),
    compiler_mode_probe:JSON.stringify({version:'v8-compiler-mode-probe-v1',collector_version:pin.v8,scope:'separate_calibration_module_export_before_first_call',module_sha256:'a'.repeat(64),liftoff:mode==='liftoff-only',optimizing:mode!=='liftoff-only'})
  }};
}
test('accepts separately verified eager tiers and the locked experimental adapter',()=>{
  for(const mode of ['liftoff-only','optimizing-only','optimizing-wasmfx-only'])validateV8Description(description(mode),pin,mode);
});
test('rejects a stale optimizing pipeline, production tiering, missing locks and contradicted tier probes',()=>{
  for(const change of [
    d=>d.runtime_version='12.4',d=>d.build='v22.23.2',d=>d.backend='production-default-tiering',
    d=>d.effective_configuration.lazy_compilation='enabled',d=>d.effective_configuration.tiering='production-default',
    d=>d.effective_configuration.flags=JSON.stringify(['--no-liftoff']),
    d=>d.effective_configuration.compiler_mode_probe=JSON.stringify({liftoff:true,optimizing:false}),
    d=>d.effective_configuration.compiler_mode_probe=JSON.stringify({...JSON.parse(d.effective_configuration.compiler_mode_probe),collector_version:'12.4'}),
    d=>d.effective_configuration.compiler_mode_probe=JSON.stringify({...JSON.parse(d.effective_configuration.compiler_mode_probe),scope:'unverified'}),
    d=>delete d.effective_configuration.compiler_mode_probe
  ]) {
    const d=description('optimizing-only');change(d);
    assert.throws(()=>validateV8Description(d,pin,'optimizing-only'));
  }
});
