import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Reject a stale optimizing pipeline before collecting or publishing timings.
export function verifyV8(root, pin, runtimes) {
  if (!runtimes.some(id => id.startsWith('v8-'))) return;
  for (const mode of ['optimizing-only', 'liftoff-only', 'optimizing-wasmfx-only']) {
    if (!runtimes.includes(mode==='optimizing-wasmfx-only'?'v8-wasmfx':`v8-${mode}`)) continue;
    const flags = ['--allow-natives-syntax', mode === 'liftoff-only' ? '--liftoff-only' : '--no-liftoff', '--no-wasm-tier-up', '--no-wasm-lazy-compilation'];
    if(mode==='optimizing-wasmfx-only')flags.push('--experimental-wasm-wasmfx');
    const result = spawnSync(process.execPath, [...flags, join(root, 'adapters/v8/adapter.mjs'), `--compiler-mode=${mode}`], {
      input: JSON.stringify({version:1,id:'tier-preflight',method:'describe'})+'\n', encoding:'utf8', timeout:30_000
    });
    if (result.status !== 0) throw new Error(`V8 ${mode} preflight failed: ${result.stderr || result.error}`);
    const description=JSON.parse(result.stdout.trim()).description;
    validateV8Description(description, pin, mode);
    console.log(`Verified V8 ${pin.v8}: eager ${mode}, tier-up disabled`);
  }
}

export function validateV8Description(description, pin, mode) {
  const flags=['--allow-natives-syntax', mode==='liftoff-only'?'--liftoff-only':'--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation'];
  if(mode==='optimizing-wasmfx-only')flags.push('--experimental-wasm-wasmfx');
  const configuration=description?.effective_configuration;
  const probe=JSON.parse(configuration?.compiler_mode_probe || 'null');
  if (!['liftoff-only','optimizing-only','optimizing-wasmfx-only'].includes(mode))throw new Error('Unknown controlled V8 mode');
  if (description?.build !== `v${pin.version}` || description?.runtime_version !== pin.v8 || description?.backend !== mode ||
    configuration?.lazy_compilation !== 'disabled' || configuration?.tiering !== mode ||
    JSON.stringify(JSON.parse(configuration?.flags || 'null')) !== JSON.stringify(flags) ||
    probe?.version!=='v8-compiler-mode-probe-v1' || probe?.collector_version!==pin.v8 ||
    probe?.scope!=='separate_calibration_module_export_before_first_call' || !/^[a-f0-9]{64}$/.test(probe?.module_sha256 || '') ||
    probe?.liftoff !== (mode === 'liftoff-only') || probe?.optimizing !== (mode !== 'liftoff-only')) {
    throw new Error(`V8 ${mode} differs from pinned Node ${pin.version}/V8 ${pin.v8} or its verified eager tier lock`);
  }
}
