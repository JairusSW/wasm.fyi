import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeGoModuleVersions} from './lib/go-module-versions.mjs';
const repository='ncruces/wasm2go';
const info={Version:'v0.4.9',Time:'2026-06-04T15:19:35Z',Origin:{VCS:'git',URL:'https://github.com/'+repository,Ref:'refs/tags/v0.4.9',Hash:'5a7a352caf7168949f3a7f90adaf041270d65376'}};
test('includes module-only versions without claiming a publication timestamp',()=>{
 const [version]=mergeGoModuleVersions(repository,[],[info]);
 assert.equal(version.tag_name,info.Version);
 assert.equal(version.dateBasis,'go-module-commit');
 assert.equal(version.revision,info.Origin.Hash);
 assert.match(version.html_url,/\/commit\//);
});
test('keeps GitHub publication dates when a module version also has a release',()=>{
 const release={tag_name:info.Version,published_at:'2026-06-05T00:00:00Z',html_url:'https://github.com/'+repository+'/releases/tag/'+info.Version};
 const merged=mergeGoModuleVersions(repository,[release],[info]);
 assert.equal(merged.length,1);assert.equal(merged[0].published_at,release.published_at);assert.equal(merged[0].html_url,release.html_url);
});
test('rejects unverifiable module origin and pseudo-versions',()=>{
 assert.throws(()=>mergeGoModuleVersions(repository,[],[{...info,Origin:{...info.Origin,Ref:'refs/heads/main'}}]));
 assert.throws(()=>mergeGoModuleVersions(repository,[],[{...info,Time:'invalid'}]));
 assert.throws(()=>mergeGoModuleVersions(repository,[],[{...info,Version:'v0.0.0-20260604151935-5a7a352caf71'}]));
});
test('deleted Wago canaries require a version hash matching the registry origin',()=>{
 const canary={...info,Version:'v0.1.0-canary.g5a7a352',Origin:{...info.Origin,URL:'https://github.com/wago-org/wago',Ref:'refs/heads/main'}};
 assert.equal(mergeGoModuleVersions('wago-org/wago',[],[canary])[0].revision,info.Origin.Hash);
 assert.throws(()=>mergeGoModuleVersions('wago-org/wago',[],[{...canary,Version:'v0.1.0-canary.g0000000'}]));
 assert.throws(()=>mergeGoModuleVersions('wago-org/wago',[],[{...canary,Origin:{...canary.Origin,Ref:'refs/heads/other'}}]));
});
test('a published release remains independently bound when old proxy metadata names a branch',()=>{
 const release={tag_name:info.Version,published_at:'2026-06-05T00:00:00Z',html_url:'https://github.com/'+repository+'/releases/tag/'+info.Version};
 const [version]=mergeGoModuleVersions(repository,[release],[{...info,Origin:{...info.Origin,Ref:'refs/heads/main'}}]);
 assert.equal(version.published_at,release.published_at);
 assert.equal(version.revision,undefined);
});
