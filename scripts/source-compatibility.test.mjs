import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceContains,wagoArchitectureUnavailable} from './lib/source-compatibility.mjs';
test('detects the FsPerms API without requiring ripgrep on workers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sdk-api-'));
 try{await mkdir(join(root,'nested'));await writeFile(join(root,'nested','api.rs'),'pub enum FsPerms { ReadOnly }');assert.equal(await sourceContains(root,/pub (?:struct|enum) FsPerms/),true);assert.equal(await sourceContains(root,/pub struct Missing/),false);}finally{await rm(root,{recursive:true,force:true});}
});
test('separates unsupported historical architecture from other build errors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wago-arch-'));
 try{
  await writeFile(join(root,'go.mod'),'module github.com/wago-org/wago\n\ngo 1.22\n');await mkdir(join(root,'src/core/runtime'),{recursive:true});await writeFile(join(root,'src/core/runtime','engine_linux_amd64.go'),'//go:build linux && amd64\npackage runtime\ntype Engine struct {}\n');
  const unsupported=await wagoArchitectureUnavailable(root,{...process.env,GOOS:'darwin',GOARCH:'arm64'});assert.equal(unsupported?.buildConstraint,'linux && amd64');assert.equal(await wagoArchitectureUnavailable(root,{...process.env,GOOS:'linux',GOARCH:'amd64'}),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
