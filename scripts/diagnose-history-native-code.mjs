// Small SDK probes under the same lock as production captures; never published.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
const [rootArg,directoryArg,engine]=process.argv.slice(2),root=resolve(rootArg),directory=resolve(directoryArg);
const receipt=JSON.parse(await readFile(join(directory,engine+'-build.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json'))),suite=JSON.parse(await readFile(join(directory,'suite.json')));
const ids=['applications/numeric-euclidean-gcd','mechanisms/wasm-to-host-call','mechanisms/wasm-host-wasm-loop','wago/utf-as-simd/validateN','wago/json-as-simd/serializeN'];
const release=await acquireMeasurementLock(join(root,'measurement-lock'));let child;
try{
 const command=receipt.runtime.command,env={...process.env,...template.env,...receipt.env,GOMAXPROCS:'1',WASMBENCH_CODE_SIZE_ONLY:'1'};
 child=spawn(process.platform==='linux'?'taskset':'taskpolicy',process.platform==='linux'?['-c',String(template.cpu),...command]:['-a','-t','0','-l','0',...command],{cwd:receipt.root,env,stdio:['pipe','pipe','pipe']});
 let stderr='';child.stderr.on('data',bytes=>stderr=(stderr+bytes).slice(-4096));const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();let id=0;
 async function request(method,fields={}){const key=++id;child.stdin.write(JSON.stringify({version:1,id:key,method,...fields})+'\n');const line=await lines.next();if(line.done)throw Error(stderr||'Adapter exited');const value=JSON.parse(line.value);if(value.id!==key)throw Error('RPC identity differs');return value;}
 const described=await request('describe'),results=[];
 for(const name of ids){
  const original=suite.find(w=>w.id===name);if(!original)throw Error('Probe artifact missing');const workload=structuredClone(original);workload.args=workload.args.map(String);
  const prepared=await request('prepare',{prepare:{profile:'code',workload,artifact:workload.artifact,artifact_sha256:workload.sha256}});
  const result=prepared.status==='ok'?await request('inspect'):prepared;
  const summary={workload:name,status:result.status,reason:result.reason||result.error,diagnostics:result.diagnostics,imageBytes:typeof result.code_image?.data==='string'?Buffer.from(result.code_image.data,'base64').length:null};results.push(summary);console.log(JSON.stringify(summary));
 }
 await request('close');await atomicJSON(join(directory,'native-code-diagnosis.json'),{scope:'Code-only SDK probes; not corpus coverage',description:described.description,results,completed:new Date().toISOString()});
}finally{child?.kill('SIGTERM');await release();}
