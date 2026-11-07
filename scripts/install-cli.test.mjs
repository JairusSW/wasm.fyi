import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readlink} from 'node:fs/promises';
import {tmpdir,platform,arch} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const installer=resolve('static/install.sh');
test('curl installer verifies packages, installs without build tools, preserves data, and rejects corruption',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-install-')),revision='a'.repeat(40),target=(platform()==='darwin'?'darwin':'linux')+'-'+(arch()==='arm64'?'arm64':'amd64');
 try{
  const fixture=join(root,'fixture'),release=join(fixture,revision),packageRoot=join(root,'package'),assets=join(root,'assets'),home=join(root,'home'),mocks=join(root,'mocks');
  for(const path of [release,join(packageRoot,'bin'),join(assets,'share/wasmfyi/scripts/local'),join(assets,'share/wasmfyi/build'),mocks,join(home,'.wasmfyi/data')])await mkdir(path,{recursive:true});
  await writeFile(join(fixture,'latest.txt'),revision+'\n');
  await writeFile(join(packageRoot,'bin/wasmfyi'),'#!/bin/sh\nprintf "wasmfyi '+revision+'\\n"\n',{mode:0o755});
  await writeFile(join(assets,'share/wasmfyi/scripts/local/worker.mjs'),'// public worker');await writeFile(join(assets,'share/wasmfyi/build/404.html'),'<html></html>');
  const binary='wasmfyi-'+target+'.tar.gz';execFileSync('tar',['-czf',join(release,binary),'-C',packageRoot,'bin']);execFileSync('tar',['-czf',join(release,'assets.tar.gz'),'-C',assets,'share']);
  const checksums=[];for(const name of [binary,'assets.tar.gz'])checksums.push(createHash('sha256').update(await readFile(join(release,name))).digest('hex')+'  '+name);await writeFile(join(release,'SHA256SUMS'),checksums.join('\n')+'\n');
  await writeFile(join(mocks,'curl'),`#!/bin/sh
output=;url=
while [ "$#" -gt 0 ]; do
 case "$1" in -o) output=$2; shift 2;; https://*) url=$1;shift;; *) shift;; esac
done
relative=\${url#https://example.test/cli/}
cp "$FIXTURE_ROOT/$relative" "$output"
`,{mode:0o755});
  const env={...process.env,HOME:home,PATH:mocks+':'+process.env.PATH,FIXTURE_ROOT:fixture,WASMFYI_DOWNLOAD_BASE:'https://example.test/cli'};delete env.WASMFYI_INSTALL_DIR;
  await writeFile(join(home,'.wasmfyi/data/keep'),'results');
  const installed=spawnSync('sh',[installer],{env,encoding:'utf8'});assert.equal(installed.status,0,installed.stdout+installed.stderr);
  assert.equal(execFileSync(join(home,'.wasmfyi/bin/wasmfyi'),['version'],{encoding:'utf8'}).trim(),'wasmfyi '+revision);assert.equal(await readFile(join(home,'.wasmfyi/data/keep'),'utf8'),'results');
  const previous=await readlink(join(home,'.wasmfyi/bin/wasmfyi'));await writeFile(join(release,binary),'corrupt');
  const rejected=spawnSync('sh',[installer],{env,encoding:'utf8'});assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/Checksum mismatch/);assert.equal(await readlink(join(home,'.wasmfyi/bin/wasmfyi')),previous);
 }finally{await rm(root,{recursive:true,force:true})}
});
