import test from 'node:test';
import assert from 'node:assert/strict';
import {withFeatureHostProfileAdmission} from './lib/feature-host-profile-policy.mjs';

test('optional embedding profiles become unsupported before ABI admission',()=>{
 const source='package experiment\n\nfunc run() {\n\tif !slices.Contains(r.Description.ABIs, w.ABI) {\n\t}\n}\n';
 const upgraded=withFeatureHostProfileAdmission(source);
 for(const profile of ['js-string-builtins-v1','jspi-v1','threads-defined-v1','threads-identity-v1','threads-opaque-identity-v1'])assert.match(upgraded,new RegExp(`w\\.HostProfile == "${profile}"`));
 assert.match(upgraded,/t\.Status, t\.Reason = "unsupported", "adapter does not advertise host profile: "\+w\.HostProfile/);
 assert.equal(withFeatureHostProfileAdmission(upgraded),upgraded);
});
