import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ports=resolve('corpora/upstream/ports');
async function fixture(run) {
  const root=await mkdtemp(join(tmpdir(),'corpus-native-ports-'));
  const bin=join(root,'bin'),source=join(root,'source'),sdk=join(root,'sdk');
  await Promise.all([mkdir(bin),mkdir(source),mkdir(join(sdk,'bin'),{recursive:true})]);
  async function command(name,body) { await writeFile(join(bin,name),'#!/usr/bin/env bash\nset -eu\n'+body,{mode:0o755}); }
  await command('git','printf "%s\\n" "$SOURCE_REV"\n');
  const env={...process.env,PATH:bin+':'+process.env.PATH,CALLS:join(root,'calls'),SOURCE:source,WASI_SDK_PATH:sdk};
  try { await run({root,source,sdk,env,command}); } finally { await rm(root,{recursive:true,force:true}); }
}

test('native Swift requires the pinned Linux compiler before installing an SDK',async()=>fixture(async({root,source,env,command})=>{
  await command('swift','printf "%s\\n" "$*" >> "$CALLS"\nprintf "Swift version 6.3.3 (swift-6.3.3-RELEASE)\\nTarget: arm64-apple-macosx\\n"\n');
  const result=spawnSync('bash',[join(ports,'swift-format/build.sh'),source,join(root,'out.wasm')],{encoding:'utf8',env:{...env,SOURCE_REV:'92097d54ac3be47738fe77e38c918e9aabce0302',WASMBENCH_NATIVE_SWIFT:'1'}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Linux x86_64 Swift 6\.3\.3/);
  assert.equal(await readFile(env.CALLS,'utf8'),'--version\n');
}));

test('native Swift retains the SDK checksum, source lock and release build flags',async()=>fixture(async({root,source,env,command})=>{
  await command('swift',`printf '%s\\n' "$*" >> "$CALLS"
case "$1" in
  --version) printf 'Swift version 6.3.3 (swift-6.3.3-RELEASE)\\nTarget: x86_64-unknown-linux-gnu\\n';;
  sdk) if [[ "$2" == list ]]; then exit 0; fi;;
  build) mkdir -p .build/release; printf '\\0asm\\1\\0\\0\\0' > .build/release/swift-format.wasm;;
esac
`);
  const output=join(root,'out.wasm');
  const result=spawnSync('bash',[join(ports,'swift-format/build.sh'),source,output],{encoding:'utf8',env:{...env,SOURCE_REV:'92097d54ac3be47738fe77e38c918e9aabce0302',WASMBENCH_NATIVE_SWIFT:'1'}});
  assert.equal(result.status,0,result.stderr);
  assert.equal((await readFile(output)).toString('hex'),'0061736d01000000');
  assert.equal(await readFile(join(source,'Package.resolved'),'utf8'),await readFile(join(ports,'swift-format/Package.resolved'),'utf8'));
  const calls=await readFile(env.CALLS,'utf8');
  assert.match(calls,/sdk install https:\/\/download\.swift\.org\/swift-6\.3\.3-release\/wasm-sdk\/.* --checksum cabfa08b73bb8ac783927ecd15fa386e99d0c139c5f232445067bcf58379cae7/);
  assert.match(calls,/build --product swift-format --swift-sdk swift-6\.3\.3-RELEASE_wasm --force-resolved-versions -c release -j 2/);
}));

test('Ruby rejects a different WASI SDK compiler before source generation',async()=>fixture(async({source,sdk,env})=>{
  await writeFile(join(sdk,'bin/clang'),'#!/bin/sh\necho "clang version 23.1.0-wasi-sdk"\n',{mode:0o755});
  const result=spawnSync('bash',[join(ports,'legacy/ruby.sh'),source],{encoding:'utf8',env:{...env,SOURCE_REV:'e51014f9c05aa65cbf203442d37fef7c12390015'}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/WASI SDK 19 compiler/);
}));

test('Ruby rejects a different Binaryen before source generation',async()=>fixture(async({source,sdk,env,command})=>{
  await writeFile(join(sdk,'bin/clang'),'#!/bin/sh\necho "clang version 15.0.7"\n',{mode:0o755});
  await command('wasm-opt','echo "wasm-opt version 130 (version_130)"\n');
  const result=spawnSync('bash',[join(ports,'legacy/ruby.sh'),source],{encoding:'utf8',env:{...env,SOURCE_REV:'e51014f9c05aa65cbf203442d37fef7c12390015'}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Binaryen wasm-opt version 108/);
}));

test('Yosys isolates the legacy SDK from the parent corpus SDK environment',async()=>fixture(async({source,sdk,env,command})=>{
  await writeFile(join(sdk,'bin/clang'),'#!/bin/sh\necho "clang version 15.0.7"\n',{mode:0o755});
  await command('git','if [[ "$1" == -C ]]; then echo fbab08acf14cc5e1fda6c33ba03094e348ea8953; else echo d0ee6801cc45748a8630a04723eb290fcff1a7bf; fi\n');
  await writeFile(join(source,'build.sh'),'#!/bin/sh\nif [ "${WASI_SDK+x}" = x ]; then echo "parent SDK leaked" >&2; exit 42; fi\nprintf "legacy build environment ready\\n"\n');
  const result=spawnSync('bash',[join(ports,'legacy/yosys.sh'),source],{encoding:'utf8',env:{...env,WASI_SDK:'/different-sdk'}});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/legacy build environment ready/);
}));

test('Swift keeps the digest-pinned Docker route by default',async()=>fixture(async({root,source,env,command})=>{
  await command('docker',`printf '%s\\n' "$*" > "$CALLS"
mkdir -p "$SOURCE/.build/release"
printf '\\0asm\\1\\0\\0\\0' > "$SOURCE/.build/release/swift-format.wasm"
`);
  const output=join(root,'out.wasm');
  const result=spawnSync('bash',[join(ports,'swift-format/build.sh'),source,output],{encoding:'utf8',env:{...env,SOURCE_REV:'92097d54ac3be47738fe77e38c918e9aabce0302',WASMBENCH_NATIVE_SWIFT:'0'}});
  assert.equal(result.status,0,result.stderr);
  assert.equal((await readFile(output)).toString('hex'),'0061736d01000000');
  const calls=await readFile(env.CALLS,'utf8');
  assert.match(calls,/run --rm --platform linux\/amd64 --memory=8g --cpus=2/);
  assert.match(calls,/swift@sha256:cd45c27b3abc42310c33cfaf3008b18156cbdc9187834c9617e8f43a26d2675c/);
}));
