import {digest} from './wasmbench.mjs';

// Include every execution/oracle input. Paths and editorial display metadata
// do not change the contract; changing vectors or initialization does.
export function workloadContract(workload){
 const w=workload;
 return digest(Buffer.from(JSON.stringify({id:w.id,sha256:w.sha256,abi:w.abi,export:w.export,args:(w.args||[]).map(String),oracle:{...w.oracle,...(w.oracle?.expected?{expected:w.oracle.expected.map(String)}:{})},command:w.command,reset:w.reset,initialize:w.initialize||undefined,input:w.input,vectors:w.vectors,hostProfile:w.host_profile||undefined})));
}
