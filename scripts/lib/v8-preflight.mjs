import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Reject a stale optimizing pipeline before collecting or publishing timings.
export function verifyV8(root, pin, runtimes, requestedMode) {
  const controlledDefault=runtimes.includes('v8') && requestedMode;
  if(controlledDefault && !['optimizing-only','liftoff-only'].includes(requestedMode))throw Error('Invalid V8 compiler mode');
  const mode=runtimes.includes('v8-optimizing-only')?'optimizing-only':runtimes.includes('v8')?(requestedMode || 'production-default'):null;
  if (!mode) return;
    const compilerFlags=mode!=='production-default'?['--allow-natives-syntax',mode==='liftoff-only'?'--liftoff-only':'--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation',...(controlledDefault?['--no-wasm-native-module-cache']:[])]:[];
    const result = spawnSync(process.execPath, [...compilerFlags,join(root, 'adapters/v8/adapter.mjs'),...(mode!=='production-default'?['--compiler-mode='+mode]:[])], {
      input: JSON.stringify({version:1,id:'tier-preflight',method:'describe'})+'\n', encoding:'utf8', timeout:30_000
    });
    if (result.status !== 0) throw new Error(`V8 ${mode} preflight failed: ${result.stderr || result.error}`);
    const description=JSON.parse(result.stdout.trim()).description;
    validateV8Description(description, pin, mode,{allowLegacyCache:!controlledDefault && mode==='optimizing-only'});
    console.log(`Verified V8 ${pin.v8}: ${mode}`);
}

export function validateV8Description(description, pin, mode, {allowLegacyCache=false}={}) {
  if(mode==='production-default') {
    const configuration=description?.effective_configuration;
    const recordedFlags=JSON.parse(configuration?.flags || 'null');
    const forbidden=['--allow-natives-syntax','--liftoff-only','--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation'];
    const validFlags=Array.isArray(recordedFlags) && recordedFlags.every(flag=>!forbidden.includes(flag) && flag!=='--experimental-wasm-wasmfx');
    if(description?.build!==`v${pin.version}` || description?.runtime_version!==pin.v8 || description?.backend!=='production-default-tiering' ||
      configuration?.tiering!=='production-default' || !validFlags || configuration?.compiler_mode_probe) {
      throw new Error(`V8 differs from pinned Node ${pin.version}/V8 ${pin.v8} or does not use production-default tiering`);
    }
    return;
  }
  const flags=['--allow-natives-syntax', mode==='liftoff-only'?'--liftoff-only':'--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation','--no-wasm-native-module-cache'];
  const configuration=description?.effective_configuration;
  const recordedFlags=JSON.parse(configuration?.flags || 'null');
  const flagMatch=JSON.stringify(recordedFlags)===JSON.stringify(flags) || allowLegacyCache && JSON.stringify(recordedFlags)===JSON.stringify(flags.filter(f=>f!=='--no-wasm-native-module-cache'));
  const probe=JSON.parse(configuration?.compiler_mode_probe || 'null');
  if (!['liftoff-only','optimizing-only'].includes(mode))throw new Error('Unknown controlled V8 mode');
  if (description?.build !== `v${pin.version}` || description?.runtime_version !== pin.v8 || description?.backend !== mode ||
    configuration?.lazy_compilation !== 'disabled' || configuration?.tiering !== mode ||
    !flagMatch ||
    probe?.version!=='v8-compiler-mode-probe-v1' || probe?.collector_version!==pin.v8 ||
    probe?.scope!=='separate_calibration_module_export_before_first_call' || !/^[a-f0-9]{64}$/.test(probe?.module_sha256 || '') ||
    probe?.liftoff !== (mode === 'liftoff-only') || probe?.optimizing !== (mode !== 'liftoff-only')) {
    throw new Error(`V8 ${mode} differs from pinned Node ${pin.version}/V8 ${pin.v8} or its verified eager tier lock`);
  }
}
