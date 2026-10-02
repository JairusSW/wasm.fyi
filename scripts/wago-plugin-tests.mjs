import {spawn} from 'node:child_process';
import {site,command} from './lib/wasmbench.mjs';

// Independent hosts run concurrently. Official Preview 1 fixtures use the
// released plugin's Linux runner; portable Preview 1/2 tests run on both hosts.
function collect(script,lanes){
  return new Promise((resolve,reject)=>{
    let output='';
    const child=spawn(process.execPath,[script,script.endsWith('hub.mjs')?'conformance':'collect'],{
      cwd:site,stdio:['inherit','pipe','inherit'],env:{...process.env,WASMBENCH_CONFORMANCE_LANES:lanes}
    });
    child.stdout.on('data',chunk=>{output+=chunk.toString();process.stdout.write(chunk);});
    child.on('error',reject);
    child.on('exit',(code,signal)=>resolve({script,code,signal,report:output.match(/^Conformance evidence: (.+)$/m)?.[1]}));
  });
}
const results=await Promise.allSettled([
  collect('scripts/conformance.mjs','wago-wasi-library,wago-component'),
  collect('scripts/hub.mjs','wago-wasi-library,wago-wasi,wago-component')
]);
// Collection seals failed assertions too. Publish the Mac archive after both
// workers finish; Hub imports its independently verified transport archive.
const mac=results[0];
if(mac.status==='fulfilled' && mac.value.report)command(process.execPath,['scripts/publish-conformance.mjs',mac.value.report],{stdio:'inherit'});
else {console.error('Mac collection did not produce a sealed report.');process.exitCode=1;}
for(const result of results){
  if(result.status==='rejected' || result.value.code!==0){
    console.error(result.status==='rejected'?result.reason:result.value);
    process.exitCode=1;
  }
}
