import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {atomicJSON} from './benchmark-plan.mjs';
import {runCommand} from './benchmark-process.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
export function withFeatureHostProfileAdmission(source){
 if(source.includes('"adapter does not advertise host profile: "+w.HostProfile'))return source;
 const anchor='\tif !slices.Contains(r.Description.ABIs, w.ABI) {';
 if(!source.includes(anchor))throw Error('Feature host-profile admission anchor absent');
 return source.replace(anchor,'\tif w.HostProfile == "js-string-builtins-v1" || w.HostProfile == "jspi-v1" || w.HostProfile == "threads-defined-v1" {\n\t\tif !r.Description.Capabilities["can_host_profile_"+w.HostProfile] {\n\t\t\tt.Status, t.Reason = "unsupported", "adapter does not advertise host profile: "+w.HostProfile\n\t\t\treturn\n\t\t}\n\t}\n'+anchor);
}
// Caller owns both the host/project reservation; only the cached Go controller changes.
export async function upgradeFeatureHostProfileController({root,controller,env}){
 const file=join(root,'experiment/runner.go'),before=await readFile(file,'utf8'),after=withFeatureHostProfileAdmission(before);
 if(before===after)return;
 const oldController=hash(await readFile(controller));await writeFile(file+'.before-feature-host-profile',before);await writeFile(file,after);
 const log=join(root,'feature-host-profile-controller.log');
 await runCommand('gofmt',['-w',file],{cwd:root,env,log});
 await runCommand('git',['add','experiment/runner.go'],{cwd:root,env,log});
 await runCommand('git',['-c','user.name=wasmfyi benchmark harness','-c','user.email=benchmark@localhost','commit','--allow-empty','-m','Admit declared optional feature host profiles'],{cwd:root,env,log});
 await runCommand('go',['build','-trimpath','-o',controller,'./cmd/wasmbench'],{cwd:root,env:{...env,GOMAXPROCS:undefined},log});
 await atomicJSON(join(root,'feature-host-profile-controller.json'),{policy:'declared-feature-host-profile-v1',oldControllerSha256:oldController,controllerSha256:hash(await readFile(controller)),sourceSha256:hash(await readFile(file)),runtimeSDKRebuilt:false,at:new Date().toISOString()});
}
