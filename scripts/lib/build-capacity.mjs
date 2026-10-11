import {statfs,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export function buildCapacityPolicy(engine,env=process.env) {
 const reserve=Number(env.WASMFYI_BUILD_MIN_FREE_BYTES??8*1024**3);
 if(!Number.isSafeInteger(reserve)||reserve<0)throw Error('Invalid WASMFYI_BUILD_MIN_FREE_BYTES');
 const raw=env.WASMFYI_BUILD_GROWTH_BYTES_BY_ENGINE;
 if(raw===undefined)return {reserve,growth:0,estimated:false,minimum:reserve};
 let growths;try{growths=JSON.parse(raw)}catch{throw Error('Invalid build growth estimates')}
 if(!growths||Array.isArray(growths)||typeof growths!=='object'||reserve<=0)throw Error('Invalid build growth estimates');
 for(const name of ['v8','jsc','graalwasm'])if(!Number.isSafeInteger(growths[name])||growths[name]<=0)throw Error('Missing positive build growth estimate for '+name);
 for(const [name,value]of Object.entries(growths))if(!Number.isSafeInteger(value)||value<=0)throw Error('Invalid build growth estimate for '+name);
 const growth=growths[engine]??0,minimum=reserve+growth;
 if(!Number.isSafeInteger(minimum))throw Error('Build capacity estimate overflow');
 return {reserve,growth,estimated:true,minimum};
}

export async function requireBuildCapacity(directory,engine,env=process.env,io={statfs,writeFile}) {
 const policy=buildCapacityPolicy(engine,env),minimum=policy.minimum;
 const fs=await io.statfs(directory,{bigint:true});
 const available=Number(fs.bavail*fs.bsize);
 const receipt={checkedAt:new Date().toISOString(),engine,availableBytes:available,minimumBytes:minimum,reserveBytes:policy.reserve,growthEstimateBytes:policy.growth,status:available>=minimum?'passed':'insufficient-capacity',scope:policy.estimated?'Observed footprint plus conservative growth allowance and reserve; estimate is not a build-fit guarantee':'pre-build reserve check; does not predict total compiler storage'};
 await io.writeFile(join(directory,'build-capacity.json'),JSON.stringify(receipt,null,2)+'\n');
 if(available<minimum){const error=Error(`SDK build disk capacity: ${available} bytes available, ${minimum} bytes required before ${engine}; preserve caches and repair capacity before retry`);error.code='WASMFYI_DISK_CAPACITY';throw error;}
 return receipt;
}

// SDK commands already run under the host lease. Poll free blocks rather than
// walking build trees; cancel the command if growth consumes the reserve.
export async function withBuildReserve(directory,engine,env,operation,io={statfs,writeFile},pollMs=10000) {
 const policy=buildCapacityPolicy(engine,env);
 if(!policy.estimated)return operation(undefined);
 const abort=new AbortController();let failure,polling=false;
 const inspect=async()=>{
  const fs=await io.statfs(directory,{bigint:true}),available=Number(fs.bavail*fs.bsize);
  if(available<policy.reserve){await io.writeFile(join(directory,'build-capacity-growth.json'),JSON.stringify({checkedAt:new Date().toISOString(),engine,availableBytes:available,reserveBytes:policy.reserve,growthEstimateBytes:policy.growth,status:'growth-exhausted-reserve'})+'\n');const error=Error(`SDK growth exhausted reserve before ${engine}: ${available} bytes available, ${policy.reserve} required; preserve source and repair capacity`);error.code='WASMFYI_DISK_CAPACITY';throw error;}
 };
 await inspect();
 const timer=setInterval(async()=>{if(polling||failure)return;polling=true;try{await inspect()}catch(error){failure=error;abort.abort(error)}finally{polling=false}},pollMs);
 timer.unref();
 try{const result=await operation(abort.signal);if(failure)throw failure;await inspect();return result}
 catch(error){throw failure||error}
 finally{clearInterval(timer)}
}
