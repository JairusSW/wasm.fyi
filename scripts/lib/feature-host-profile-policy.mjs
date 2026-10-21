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
export async function withProposalSourceAdmission(analyzer,runner){
 const helper=await readFile(new URL('../patches/proposal-source-evidence.go.inc',import.meta.url),'utf8');
 if(!analyzer.includes('func sourceValidatedProposalEvidence(')){
  const importAnchor='\t"fmt"\n';if(!analyzer.includes(importAnchor))throw Error('Proposal analyzer import anchor absent');
  analyzer=analyzer.replace(importAnchor,importAnchor+'\t"github.com/wasmbench/wasmbench/protocol"\n');
  const fieldAnchor='\t\tProbes          *featureProbeEvidence `json:"feature_probes"`\n';if(!analyzer.includes(fieldAnchor))throw Error('Proposal analyzer result anchor absent');
  analyzer=analyzer.replace(fieldAnchor,fieldAnchor+'\t\tProposalSource  *proposalSourceEvidence `json:"proposal_source"`\n');
  const validationAnchor='\tif result.Schema != 2 || result.Analyzer != a.Name || result.Version != a.Version || !versionOK || result.SHA256 != digest || result.Profile != a.Profile || !result.Validated || len(result.Features) == 0 {\n\t\treturn fmt.Errorf("analyzer evidence does not match locked artifact, policy, or analysis version")\n\t}\n';
  if(!analyzer.includes(validationAnchor))throw Error('Proposal analyzer validation anchor absent');
  analyzer=analyzer.replace(validationAnchor,'\tif result.Schema != 2 || result.Analyzer != a.Name || result.Version != a.Version || !versionOK || result.SHA256 != digest || result.Profile != a.Profile || !result.Validated || len(result.Features) == 0 {\n\t\tif result.AnalysisVersion != "proposal-source-v1" || result.Encoding != "core-module" || result.Schema != 2 || result.Analyzer != "source-bound-v8" || result.Version != "15.2.20" || result.SHA256 != digest || result.Profile != a.Profile || !result.Validated || len(result.Features) != 1 || result.ProposalSource == nil || result.ProposalSource.validate(result.Features[0]) != nil {\n\t\t\treturn fmt.Errorf("analyzer evidence does not match locked artifact, policy, or analysis version")\n\t\t}\n\t\treturn nil\n\t}\n');
  const helperAnchor='type featureProbeEvidence struct {';if(!analyzer.includes(helperAnchor))throw Error('Proposal analyzer helper anchor absent');
  analyzer=analyzer.replace(helperAnchor,helper+'\n'+helperAnchor);
 }
 if(!runner.includes('sourceValidatedProposalEvidence(w, lock.Analyzer)')){
  const runnerAnchor='\t\t\t\tif e != nil {\n\t\t\t\t\treturn out, fmt.Errorf("workload %s admission: %w", w.ID, e)\n\t\t\t\t}\n';
  if(!runner.includes(runnerAnchor))throw Error('Proposal admission runner anchor absent');
  runner=runner.replace(runnerAnchor,'\t\t\t\tif e != nil {\n\t\t\t\t\tvar ok bool\n\t\t\t\t\tif evidence, ok = sourceValidatedProposalEvidence(w, lock.Analyzer); !ok {\n\t\t\t\t\t\treturn out, fmt.Errorf("workload %s admission: %w", w.ID, e)\n\t\t\t\t\t}\n\t\t\t\t}\n');
 }
 return {analyzer,runner};
}
// Caller owns both the host/project reservation; only the cached Go controller changes.
export async function upgradeFeatureHostProfileController({root,controller,env}){
 const file=join(root,'experiment/runner.go'),valuesFile=join(root,'protocol/types.go'),analyzerFile=join(root,'experiment/analyzer.go');
 const before=await readFile(file,'utf8'),valuesBefore=await readFile(valuesFile,'utf8'),analyzerBefore=await readFile(analyzerFile,'utf8');
 let after=withFeatureHostProfileAdmission(before),analyzerAfter;({runner:after,analyzer:analyzerAfter}=await withProposalSourceAdmission(analyzerBefore,after));const valuesAfter=withSignedWireValues(valuesBefore);
 if(before===after&&valuesBefore===valuesAfter&&analyzerBefore===analyzerAfter)return;
 const oldController=hash(await readFile(controller));
 if(before!==after){await writeFile(file+'.before-feature-host-profile',before);await writeFile(file,after)}
 if(valuesBefore!==valuesAfter){await writeFile(valuesFile+'.before-signed-wire-values',valuesBefore);await writeFile(valuesFile,valuesAfter)}
 if(analyzerBefore!==analyzerAfter){await writeFile(analyzerFile+'.before-proposal-source-admission',analyzerBefore);await writeFile(analyzerFile,analyzerAfter)}
 const log=join(root,'feature-host-profile-controller.log');
 await runCommand('gofmt',['-w',file,valuesFile,analyzerFile],{cwd:root,env,log});
 await runCommand('git',['add','experiment/runner.go','protocol/types.go','experiment/analyzer.go'],{cwd:root,env,log});
 await runCommand('git',['-c','user.name=wasmfyi benchmark harness','-c','user.email=benchmark@localhost','commit','--allow-empty','-m','Admit optional feature profiles and signed wire values'],{cwd:root,env,log});
 await runCommand('go',['build','-trimpath','-o',controller,'./cmd/wasmbench'],{cwd:root,env:{...env,GOMAXPROCS:undefined},log});
 await atomicJSON(join(root,'feature-host-profile-controller.json'),{policy:'declared-feature-host-profile-signed-values-and-proposal-source-v3',oldControllerSha256:oldController,controllerSha256:hash(await readFile(controller)),sourceSha256:hash(await readFile(file)),valuesSourceSha256:hash(await readFile(valuesFile)),analyzerSourceSha256:hash(await readFile(analyzerFile)),runtimeSDKRebuilt:false,at:new Date().toISOString()});
}
