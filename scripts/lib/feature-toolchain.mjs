import { homedir } from 'node:os';
import { join } from 'node:path';
import { exists } from './wasmbench.mjs';
export const featureToolchainRoot=join(homedir(),'.local/share/wasm-fyi/toolchains/wasm-tools-1.260.0');
export async function featureCompiler() {
  if(process.env.WASMBENCH_WASM_TOOLS)return process.env.WASMBENCH_WASM_TOOLS;
  const pinned=join(featureToolchainRoot,'bin/wasm-tools');
  return await exists(pinned)?pinned:'wasm-tools';
}
