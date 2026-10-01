import { spawnSync } from 'node:child_process';
export function featureConfigurations(settings) {
  const ids=[...settings.collection.runtimes,'wasmtime-component-async'];
  const wasmfx=spawnSync(process.execPath,['--experimental-wasm-wasmfx','-e',''],{stdio:'ignore'});
  if(wasmfx.status===0)ids.push('v8-wasmfx');
  return [...new Set(ids)];
}
