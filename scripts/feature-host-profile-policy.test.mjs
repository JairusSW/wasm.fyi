import test from 'node:test';
import assert from 'node:assert/strict';
import {withFeatureHostProfileAdmission,withSignedWireValues,pinnedAnalyzerIdentity,withProposalSourceAdmission} from './lib/feature-host-profile-policy.mjs';

test('optional embedding profiles become unsupported before ABI admission',()=>{
 const source='package experiment\n\nfunc run() {\n\tif !slices.Contains(r.Description.ABIs, w.ABI) {\n\t}\n}\n';
 const upgraded=withFeatureHostProfileAdmission(source);
 for(const profile of ['js-string-builtins-v1','jspi-v1','threads-defined-v1','threads-identity-v1','threads-opaque-identity-v1'])assert.match(upgraded,new RegExp(`w\\.HostProfile == "${profile}"`));
 assert.match(upgraded,/t\.Status, t\.Reason = "unsupported", "adapter does not advertise host profile: "\+w\.HostProfile/);
 assert.equal(withFeatureHostProfileAdmission(upgraded),upgraded);
});

test('an older partial guard is reconciled with every optional profile',()=>{
 const source='package experiment\n\nfunc run() {\n\tif w.HostProfile == "js-string-builtins-v1" || w.HostProfile == "threads-defined-v1" {\n\t\tif !r.Description.Capabilities["can_host_profile_"+w.HostProfile] {\n\t\t\tt.Status, t.Reason = "unsupported", "adapter does not advertise host profile: "+w.HostProfile\n\t\t\treturn\n\t\t}\n\t}\n}\n';
 const upgraded=withFeatureHostProfileAdmission(source);
 for(const profile of ['js-string-builtins-v1','jspi-v1','threads-defined-v1','threads-identity-v1','threads-opaque-identity-v1'])assert.equal(upgraded.split(`w.HostProfile == "${profile}"`).length,2);
 assert.equal(withFeatureHostProfileAdmission(upgraded),upgraded);
});

test('signed decimal values are accepted as exact two-complement bits',()=>{
 const source='package protocol\n\nfunc decode(s string) error {\n\t\tn, e := strconv.ParseUint(s, 10, 64)\n\t\tif e != nil {\n\t\t\treturn fmt.Errorf("invalid unsigned result %q: %w", s, e)\n\t\t}\n\t\tout[i] = n\n\treturn nil\n}\n';
 const upgraded=withSignedWireValues(source);
 assert.match(upgraded,/strconv\.ParseInt\(s, 10, 64\)/);
 assert.match(upgraded,/n = uint64\(signed\)/);
 assert.equal(withSignedWireValues(upgraded),upgraded);
});

test('the controller pins the identity declared by its exact analyzer source',()=>{
 const controller='a := &AnalyzerLock{Version: "0.258.3"}\nif a.Version != "0.258.3" { return }\n';
 const pinned=pinnedAnalyzerIdentity('json!({"analyzer_version":"0.251.0"})',controller);
 assert.equal(pinned.version,'0.251.0');
 assert.equal(pinned.source,'a := &AnalyzerLock{Version: "0.251.0"}\nif a.Version != "0.251.0" { return }\n');
 assert.throws(()=>pinnedAnalyzerIdentity('no identity',controller),/absent or ambiguous/);
});

test('pinned proposal source validation is an explicit analyzer fallback',async()=>{
 const analyzer='package experiment\nimport (\n\t"fmt"\n)\nfunc validate() {\n\tvar result struct {\n\t\tProbes          *featureProbeEvidence `json:"feature_probes"`\n\t}\n\tversionOK := true\n\tdigest := ""\n\ta := &AnalyzerLock{}\n\tif result.Schema != 2 || result.Analyzer != a.Name || result.Version != a.Version || !versionOK || result.SHA256 != digest || result.Profile != a.Profile || !result.Validated || len(result.Features) == 0 {\n\t\treturn fmt.Errorf("analyzer evidence does not match locked artifact, policy, or analysis version")\n\t}\n}\ntype featureProbeEvidence struct {}\n';
 const runner='package experiment\nfunc run() {\n\t\t\t\tif e != nil {\n\t\t\t\t\treturn out, fmt.Errorf("workload %s admission: %w", w.ID, e)\n\t\t\t\t}\n}\n';
 const upgraded=await withProposalSourceAdmission(analyzer,runner);
 assert.match(upgraded.analyzer,/source-bound-v8/);assert.match(upgraded.analyzer,/sourceValidatedProposalEvidence/);assert.match(upgraded.runner,/sourceValidatedProposalEvidence\(w, lock\.Analyzer\)/);
 assert.deepEqual(await withProposalSourceAdmission(upgraded.analyzer,upgraded.runner),upgraded);
});
