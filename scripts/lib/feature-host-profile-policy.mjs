import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {atomicJSON} from './benchmark-plan.mjs';
import {runCommand} from './benchmark-process.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
export function withFeatureHostProfileAdmission(source){
 if(source.includes('"adapter does not advertise host profile: "+w.HostProfile')){
  const guard=/\tif (w\.HostProfile == "[^"\n]+"(?: \|\| w\.HostProfile == "[^"\n]+")*) \{\n\t\tif !r\.Description\.Capabilities\["can_host_profile_"\+w\.HostProfile\] \{/;
  const match=source.match(guard);if(!match)throw Error('Existing feature host-profile admission guard is malformed');
  let profiles=match[1];
  for(const profile of ['js-string-builtins-v1','jspi-v1','threads-defined-v1','threads-identity-v1','threads-opaque-identity-v1'])if(!profiles.includes(`w.HostProfile == "${profile}"`))profiles+=` || w.HostProfile == "${profile}"`;
  source=source.replace(match[0],`\tif ${profiles} {\n\t\tif !r.Description.Capabilities["can_host_profile_"+w.HostProfile] {`);
  return source;
 }
 const anchor='\tif !slices.Contains(r.Description.ABIs, w.ABI) {';
 if(!source.includes(anchor))throw Error('Feature host-profile admission anchor absent');
 return source.replace(anchor,'\tif w.HostProfile == "js-string-builtins-v1" || w.HostProfile == "jspi-v1" || w.HostProfile == "threads-defined-v1" || w.HostProfile == "threads-identity-v1" || w.HostProfile == "threads-opaque-identity-v1" {\n\t\tif !r.Description.Capabilities["can_host_profile_"+w.HostProfile] {\n\t\t\tt.Status, t.Reason = "unsupported", "adapter does not advertise host profile: "+w.HostProfile\n\t\t\treturn\n\t\t}\n\t}\n'+anchor);
}
export function withSignedWireValues(source){
 if(source.includes('signed, signedErr := strconv.ParseInt(s, 10, 64)'))return source;
 const old='\t\tn, e := strconv.ParseUint(s, 10, 64)\n\t\tif e != nil {\n\t\t\treturn fmt.Errorf("invalid unsigned result %q: %w", s, e)\n\t\t}\n\t\tout[i] = n';
 const next='\t\tn, e := strconv.ParseUint(s, 10, 64)\n\t\tif e != nil {\n\t\t\tsigned, signedErr := strconv.ParseInt(s, 10, 64)\n\t\t\tif signedErr != nil {\n\t\t\t\treturn fmt.Errorf("invalid integer bit pattern %q: unsigned: %v; signed: %w", s, e, signedErr)\n\t\t\t}\n\t\t\tn = uint64(signed)\n\t\t}\n\t\tout[i] = n';
 if(!source.includes(old))throw Error('Signed wire-value admission anchor absent');
 return source.replace(old,next);
}
// Caller owns both the host/project reservation; only the cached Go controller changes.
export async function upgradeFeatureHostProfileController({root,controller,env}){
 const file=join(root,'experiment/runner.go'),valuesFile=join(root,'protocol/types.go');
 const before=await readFile(file,'utf8'),after=withFeatureHostProfileAdmission(before),valuesBefore=await readFile(valuesFile,'utf8'),valuesAfter=withSignedWireValues(valuesBefore);
 if(before===after&&valuesBefore===valuesAfter)return;
 const oldController=hash(await readFile(controller));
 if(before!==after){await writeFile(file+'.before-feature-host-profile',before);await writeFile(file,after)}
 if(valuesBefore!==valuesAfter){await writeFile(valuesFile+'.before-signed-wire-values',valuesBefore);await writeFile(valuesFile,valuesAfter)}
 const log=join(root,'feature-host-profile-controller.log');
 await runCommand('gofmt',['-w',file,valuesFile],{cwd:root,env,log});
 await runCommand('git',['add','experiment/runner.go','protocol/types.go'],{cwd:root,env,log});
 await runCommand('git',['-c','user.name=wasmfyi benchmark harness','-c','user.email=benchmark@localhost','commit','--allow-empty','-m','Admit optional feature profiles and signed wire values'],{cwd:root,env,log});
 await runCommand('go',['build','-trimpath','-o',controller,'./cmd/wasmbench'],{cwd:root,env:{...env,GOMAXPROCS:undefined},log});
 await atomicJSON(join(root,'feature-host-profile-controller.json'),{policy:'declared-feature-host-profile-and-signed-values-v2',oldControllerSha256:oldController,controllerSha256:hash(await readFile(controller)),sourceSha256:hash(await readFile(file)),valuesSourceSha256:hash(await readFile(valuesFile)),runtimeSDKRebuilt:false,at:new Date().toISOString()});
}
