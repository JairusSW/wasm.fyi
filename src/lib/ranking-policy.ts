/** Transpiler pipelines are displayed but do not compete for fastest compilation. */
export function compilationCandidate(runtime:string,metric:string):boolean {
 return metric!=='compile'||!['wasm2go','wasm2c','w2c2','wasm2rs'].includes(runtime.replace(/-gcc$/,''));
}
