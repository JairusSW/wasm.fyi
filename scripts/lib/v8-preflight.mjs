import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {selectV8CacheDisableFlag} from './v8-cache-flag.mjs';
import {v8SingleCoreFlags} from './v8-single-core-mode.mjs';

// Reject a stale optimizing pipeline before collecting or publishing timings.
export function verifyV8(root, pin, runtimes, requestedMode) {
  const controlledDefault=runtimes.includes('v8') && requestedMode;
  if(controlledDefault && !['optimizing-only','liftoff-only'].includes(requestedMode))throw Error('Invalid V8 compiler mode');
  const mode=runtimes.includes('v8-optimizing-only')?'optimizing-only':runtimes.includes('v8')?(requestedMode || 'production-default'):null;
  if (!mode) return;
    const node=process.env.WASMBENCH_NODE || process.execPath;
    let cacheFlag;
    if(controlledDefault){const options=spawnSync(node,['--v8-options'],{encoding:'utf8',timeout:30_000});if(options.status!==0)throw Error('Pinned V8 flag discovery failed: '+(options.stderr||options.error));cacheFlag=selectV8CacheDisableFlag(options.stdout);if(process.env.WASMBENCH_V8_CACHE_DISABLE_FLAG&&process.env.WASMBENCH_V8_CACHE_DISABLE_FLAG!==cacheFlag)throw Error('Declared V8 cache flag differs from pinned binary');}
    const compilerFlags=mode!=='production-default'?['--allow-natives-syntax',mode==='liftoff-only'?'--liftoff-only':'--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation',...(mode==='optimizing-only'&&process.env.WASMBENCH_V8_TURBOSHAFT_POLICY==='explicit-flag'?['--turboshaft-wasm']:[]),...(controlledDefault?[cacheFlag]:[])]:[];
    const result = spawnSync(node, [...compilerFlags,join(root, 'adapters/v8/adapter.mjs'),...(mode!=='production-default'?['--compiler-mode='+mode]:[])], {
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
  let recordedFlags=JSON.parse(configuration?.flags || 'null');
  const tsPolicy=configuration?.wasm_compiler_policy;
  if(description?.backend==='turboshaft'){if(configuration?.wasm_compiler!=='turboshaft'||!['explicit-flag','mandatory-source-default'].includes(tsPolicy))throw Error('Missing V8 Turboshaft provenance');if(tsPolicy==='explicit-flag'){const at=recordedFlags?.includes('--single-threaded')?7:4;if(recordedFlags?.[at]!=='--turboshaft-wasm'||recordedFlags.filter(f=>f==='--turboshaft-wasm').length!==1)throw Error('Invalid V8 Turboshaft flags');recordedFlags=recordedFlags.filter(f=>f!=='--turboshaft-wasm');}}
  const legacyFlags=flags.map(flag=>flag==='--no-wasm-native-module-cache'?'--no-wasm-native-module-cache-enabled':flag);
  const verifiedSequences=[flags,[...v8SingleCoreFlags,...flags],legacyFlags,[...v8SingleCoreFlags,...legacyFlags]];
  if(allowLegacyCache){const legacy=flags.filter(f=>f!=='--no-wasm-native-module-cache');verifiedSequences.push(legacy,[...v8SingleCoreFlags,...legacy]);}
  const flagMatch=verifiedSequences.some(sequence=>JSON.stringify(recordedFlags)===JSON.stringify(sequence));
  const probe=JSON.parse(configuration?.compiler_mode_probe || 'null');
  if (!['liftoff-only','optimizing-only'].includes(mode))throw new Error('Unknown controlled V8 mode');
  if (description?.build !== `v${pin.version}` || description?.runtime_version !== pin.v8 || ![mode,...(mode==='optimizing-only'?['turboshaft']:[])].includes(description?.backend) ||
    configuration?.lazy_compilation !== 'disabled' || configuration?.tiering !== mode ||
    !flagMatch ||
    probe?.version!=='v8-compiler-mode-probe-v1' || probe?.collector_version!==pin.v8 ||
    probe?.scope!=='separate_calibration_module_export_before_first_call' || !/^[a-f0-9]{64}$/.test(probe?.module_sha256 || '') ||
    probe?.liftoff !== (mode === 'liftoff-only') || probe?.optimizing !== (mode !== 'liftoff-only')) {
    throw new Error(`V8 ${mode} differs from pinned Node ${pin.version}/V8 ${pin.v8} or its verified eager tier lock`);
  }
}
