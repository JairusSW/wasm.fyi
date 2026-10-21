import test from 'node:test';
import assert from 'node:assert/strict';
import {v8FlagsForWorkload,withV8FeatureFlagRunner,withV8FeatureFlagCompilerMode,withV8FeatureFlagNativeSize} from './lib/v8-feature-flags.mjs';

test('selects proposal flags per workload and always records declaration-only support',()=>{
 assert.deepEqual(v8FlagsForWorkload('features/half-precision/lane-add/1'),['--experimental-wasm-branch-hinting','--experimental-wasm-compilation-hints','--experimental-wasm-fp16']);
 assert.deepEqual(v8FlagsForWorkload('features/jspi/suspend-every-call/1'),['--experimental-wasm-branch-hinting','--experimental-wasm-compilation-hints','--experimental-wasm-jspi']);
 assert.deepEqual(v8FlagsForWorkload('features/stack-switching/resume-value/1'),['--experimental-wasm-branch-hinting','--experimental-wasm-compilation-hints','--experimental-wasm-wasmfx']);
 assert.deepEqual(v8FlagsForWorkload('features/instrument-and-tracing-technology/custom-section/1'),['--experimental-wasm-branch-hinting','--experimental-wasm-compilation-hints','--experimental-wasm-instruction-tracing']);
 assert.deepEqual(v8FlagsForWorkload('features/core-num/add/1'),['--experimental-wasm-branch-hinting','--experimental-wasm-compilation-hints']);
});

test('patches each V8 launch seam idempotently',()=>{
 const runner='before\n\t\t\tr.Command = append(r.Command, filepath.Join(root, "adapters", "v8", "adapter.mjs"))\nafter';
 const mode="before\n  const mode=argv[0].slice('--compiler-mode='.length),expected=compilerModeFlags[mode];\nafter";
 const native=`before\n return ["--single-threaded","--single-threaded-gc","--wasm-num-compilation-tasks=0"].concat(['--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation',...(process.env.WASMBENCH_V8_TURBOSHAFT_POLICY==='explicit-flag'?['--turboshaft-wasm']:[]),selected]);\nafter`;
 for(const [transform,source] of [[withV8FeatureFlagRunner,runner],[withV8FeatureFlagCompilerMode,mode],[withV8FeatureFlagNativeSize,native]]){const once=transform(source);assert.match(once,/workload-scoped V8 proposal flags/);assert.equal(transform(once),once)}
});

test('upgrades retained v1 launch policies before reuse',()=>{
 const runner='before\n\t\t\tr.Command = append(r.Command, filepath.Join(root, "adapters", "v8", "adapter.mjs"))\nafter';
 const mode="before\n  const mode=argv[0].slice('--compiler-mode='.length),expected=compilerModeFlags[mode];\nafter";
 const native=`before\n return ["--single-threaded","--single-threaded-gc","--wasm-num-compilation-tasks=0"].concat(['--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation',...(process.env.WASMBENCH_V8_TURBOSHAFT_POLICY==='explicit-flag'?['--turboshaft-wasm']:[]),selected]);\nafter`;
 for(const [transform,source] of [[withV8FeatureFlagRunner,runner],[withV8FeatureFlagCompilerMode,mode],[withV8FeatureFlagNativeSize,native]]){
  const old=transform(source).replace('proposal flags v2','proposal flags v1').replaceAll(/,?['"]--experimental-wasm-(?:jspi|wasmfx|instruction-tracing)['"](?::true)?/g,'');
  const upgraded=transform(old);
  assert.match(upgraded,/proposal flags v2/);
  if(transform!==withV8FeatureFlagNativeSize)for(const flag of ['jspi','wasmfx','instruction-tracing'])assert(upgraded.includes('--experimental-wasm-'+flag));
 }
});
