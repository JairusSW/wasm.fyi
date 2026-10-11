import test from 'node:test';
import assert from 'node:assert/strict';
import {workloadContract} from './lib/workload-contract.mjs';
test('reuse identity covers vectors, initialization, input bytes and host profile',()=>{
 const workload={id:'test',sha256:'a'.repeat(64),abi:'core',export:'run',args:[1],oracle:{kind:'exact_u64',expected:[1]},reset:'stateless'};
 const identity=workloadContract(workload);
 for(const patch of [{vectors:{cases:[{len:1,out:'ff'}]}},{initialize:'initialize'},{input:{offset:0,hex:'01'}},{host_profile:'identity-v1'}])assert.notEqual(workloadContract({...workload,...patch}),identity);
 assert.equal(workloadContract({...workload,artifact:'/another/machine.wasm',source:'renamed.c',args:['1'],oracle:{kind:'exact_u64',expected:['1']}}),identity);
});
