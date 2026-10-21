import {readFile,writeFile,rm} from 'node:fs/promises';
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
export function pinnedAnalyzerIdentity(analyzerSource,controllerSource){
 const emitted=analyzerSource.match(/"analyzer_version":"([0-9]+\.[0-9]+\.[0-9]+)"/g)?.map(value=>value.match(/[0-9]+\.[0-9]+\.[0-9]+/)[0]);
 if(!emitted?.length||new Set(emitted).size!==1)throw Error('Pinned analyzer source identity is absent or ambiguous');
 const version=emitted[0],pin=controllerSource.match(/Version: "([0-9]+\.[0-9]+\.[0-9]+)"/),check=controllerSource.match(/a\.Version != "([0-9]+\.[0-9]+\.[0-9]+)"/);
 if(!pin||!check)throw Error('Controller analyzer identity anchors absent');
 return {version,source:controllerSource.replace(pin[0],`Version: "${version}"`).replace(check[0],`a.Version != "${version}"`)};
}
async function ensurePinnedAnalyzer({root,version,env,log}){
 const executable=join(root,'adapters/wasmtime/target/release/wasm-analyze'),smoke=join(root,'.feature-analyzer-smoke.wasm');
 const inspect=async()=>{
  await writeFile(smoke,Buffer.from([0,97,115,109,1,0,0,0]));
  try{return JSON.parse((await runCommand(executable,[smoke,'all'],{cwd:root,env,log})).output).analyzer_version}
  finally{await rm(smoke,{force:true})}
 };
 let actual;try{actual=await inspect()}catch{}
 if(actual!==version){
  const target=join(root,'adapters/wasmtime/target');
  await runCommand('cargo',['build','--release','--locked','--bin','wasm-analyze','--manifest-path',join(root,'adapters/wasmtime/Cargo.toml'),'--target-dir',target],{cwd:root,env:{...env,CARGO_TARGET_DIR:target},log});
  actual=await inspect();
 }
 if(actual!==version)throw Error(`Analyzer executable identity mismatch: expected ${version}, got ${actual||'unavailable'}`);
 return {version,sha256:hash(await readFile(executable))};
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
 const analyzerProgram=await readFile(join(root,'adapters/wasmtime/src/bin/wasm-analyze.rs'),'utf8');
 const identity=pinnedAnalyzerIdentity(analyzerProgram,analyzerBefore);
 let after=withFeatureHostProfileAdmission(before),analyzerAfter=identity.source;({runner:after,analyzer:analyzerAfter}=await withProposalSourceAdmission(analyzerAfter,after));const valuesAfter=withSignedWireValues(valuesBefore);
 const policy='declared-feature-host-profile-signed-values-proposal-source-and-analyzer-build-v5',log=join(root,'feature-host-profile-controller.log');
 const analyzerExecutable=await ensurePinnedAnalyzer({root,version:identity.version,env,log});
 if(before===after&&valuesBefore===valuesAfter&&analyzerBefore===analyzerAfter){
  try{
   const receipt=JSON.parse(await readFile(join(root,'feature-host-profile-controller.json'),'utf8'));
   if(receipt.policy===policy&&receipt.controllerSha256===hash(await readFile(controller))&&receipt.sourceSha256===hash(after)&&receipt.valuesSourceSha256===hash(valuesAfter)&&receipt.analyzerSourceSha256===hash(analyzerAfter)&&receipt.analyzerExecutableSha256===analyzerExecutable.sha256&&receipt.analyzerVersion===analyzerExecutable.version)return;
  }catch{}
 }
 const oldController=hash(await readFile(controller));
 if(before!==after){await writeFile(file+'.before-feature-host-profile',before);await writeFile(file,after)}
 if(valuesBefore!==valuesAfter){await writeFile(valuesFile+'.before-signed-wire-values',valuesBefore);await writeFile(valuesFile,valuesAfter)}
 if(analyzerBefore!==analyzerAfter){await writeFile(analyzerFile+'.before-proposal-source-admission',analyzerBefore);await writeFile(analyzerFile,analyzerAfter)}
 await runCommand('gofmt',['-w',file,valuesFile,analyzerFile],{cwd:root,env,log});
 await runCommand('git',['add','experiment/runner.go','protocol/types.go','experiment/analyzer.go'],{cwd:root,env,log});
 await runCommand('git',['-c','user.name=wasmfyi benchmark harness','-c','user.email=benchmark@localhost','commit','--allow-empty','-m','Admit optional feature profiles and signed wire values'],{cwd:root,env,log});
 await runCommand('go',['build','-trimpath','-o',controller,'./cmd/wasmbench'],{cwd:root,env:{...env,GOMAXPROCS:undefined},log});
 await atomicJSON(join(root,'feature-host-profile-controller.json'),{policy,oldControllerSha256:oldController,controllerSha256:hash(await readFile(controller)),sourceSha256:hash(await readFile(file)),valuesSourceSha256:hash(await readFile(valuesFile)),analyzerSourceSha256:hash(await readFile(analyzerFile)),analyzerExecutableSha256:analyzerExecutable.sha256,analyzerVersion:analyzerExecutable.version,runtimeSDKRebuilt:false,at:new Date().toISOString()});
}
