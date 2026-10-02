import test from 'node:test';
import assert from 'node:assert/strict';
import { featureConfigurations } from './feature-configurations.mjs';

test('feature suites exclude WasmFX on every platform',()=>{
  const settings={collection:{
    runtimes:['v8','v8-wasmfx'],
    featureRuntimes:['wasmi','v8-wasmfx'],
    featureRuntimesByPlatform:{darwin:['jsc','v8-wasmfx'],linux:['spidermonkey','v8-wasmfx']}
  }};
  for(const platform of ['darwin','linux']) {
    const ids=featureConfigurations(settings,platform);
    assert(ids.includes('v8'));
    assert(!ids.includes('v8-wasmfx'));
    assert(ids.includes('wasmtime-component-async'));
  }
});
