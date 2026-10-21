import test from 'node:test';
import assert from 'node:assert/strict';
import {withFeatureHostProfileAdmission,withSignedWireValues} from './lib/feature-host-profile-policy.mjs';

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
