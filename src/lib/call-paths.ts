export {CALL_LOOP_WORKLOAD,CALL_LOOP_ITERATIONS,CALL_MIN_BATCH_NS} from '../../scripts/lib/call-policy.mjs';
import {CALL_LOOP_WORKLOAD} from '../../scripts/lib/call-policy.mjs';
export const CALL_PATHS=[
 {id:CALL_LOOP_WORKLOAD,key:'wasmHostLoop',label:'Wasm → host → Wasm',note:'One exported invocation loops through 1,000,000 typed host callbacks inside Wasm. Elapsed time is divided by 1,000,000 callbacks per invocation. Includes guest loop control and amortized outer host entry/return; each accepted timing batch lasts at least 0.5 ms.'},
 {id:'mechanisms/host-to-wasm-call',key:'hostWasm',label:'Host → Wasm → host',note:'The host repeatedly calls a typed Wasm identity export and receives its result. Includes embedding invocation overhead; each accepted timing batch lasts at least 0.5 ms.'}
] as const;
