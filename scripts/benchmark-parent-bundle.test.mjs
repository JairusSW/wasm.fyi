import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {retainCollectionParent} from './lib/benchmark-parent-bundle.mjs';
import {verifyParentBundle,readParentBundleMetadata} from './lib/benchmark-bundle.mjs';
import {site} from './lib/wasmbench.mjs';
const exec=promisify(execFile);

test('shared parent writer archives exact tools once across concurrent corpus completion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wasmfyi-parent-writer-'));
  try {
    const bundle=join(root,'source'),tools=join(bundle,'tools/runner');await mkdir(tools,{recursive:true});
    const tool=Buffer.from('synthetic archived runner; never execute');await writeFile(join(tools,'wasmbench'),tool);
    const manifest={host:{id:'fixture-host'},lock:{runner_version:'fixture-runner',runner_sha256:'a'.repeat(64),analyzer:{id:'fixture-analyzer'},runtime_configurations:[{id:'fixture-engine'}]}};
    await writeFile(join(bundle,'manifest.json'),JSON.stringify(manifest));
    const plan={id:'fixture-session',identity:'b'.repeat(64),collection:{launches:1},jobs:[{workloads:[{id:'fixture/one',sha256:'c'.repeat(64)}]}]};
    const options={root:join(root,'member'),log:join(root,'commands.log'),bundle,profile:'timing',plan,host:{name:'fixture-machine',workers:1},env:{NODE_OPTIONS:''}};
    await Promise.all([retainCollectionParent(options),retainCollectionParent(options)]);
    const directory=join(options.root,'bundle'),index=await verifyParentBundle(directory,{...plan,machine:options.host.name});
    assert.equal(index.parts.length,1);
    const before=await readFile(join(directory,'index.json'));
    const metadata=await readParentBundleMetadata(directory,plan);
    assert.deepEqual(metadata.metadata.runtimes,manifest.lock.runtime_configurations);
    const archive=join(directory,index.parts[0].path);
    const extracted=await exec('tar',['-xOf',archive,'./tools/runner/wasmbench'],{encoding:'buffer'});
    assert(extracted.stdout.equals(tool));
    const archivedMetadata=await exec('tar',['-xOf',archive,'./metadata.json']);
    assert.deepEqual(JSON.parse(archivedMetadata.stdout),metadata.metadata);
    await retainCollectionParent(options);
    assert((await readFile(join(directory,'index.json'))).equals(before),'reused archive identity changed');
    await assert.rejects(retainCollectionParent({...options,host:{...options.host,name:'other-machine'}}),/changed within this session/);
    await assert.rejects(retainCollectionParent({...options,plan:{...plan,id:'other-session'}}),/changed within this session/);
    manifest.lock.runtime_configurations[0].id='changed-engine';await writeFile(join(bundle,'manifest.json'),JSON.stringify(manifest));
    await assert.rejects(retainCollectionParent(options),/changed within this session/);
    assert((await readFile(join(directory,'index.json'))).equals(before),'rejected reuse changed the archive');
  } finally {await rm(root,{recursive:true,force:true})}
});

test('shared parent writer ignores other passes and stops before cancelled work',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wasmfyi-parent-writer-stop-'));
  try {
    const member=join(root,'absent');
    await retainCollectionParent({root:member,profile:'memory'});
    await assert.rejects(access(member));
    const controller=new AbortController(),reason=Error('stop collection');controller.abort(reason);
    await assert.rejects(retainCollectionParent({root:member,profile:'timing',signal:controller.signal}),error=>error===reason);
    await assert.rejects(access(member));
  } finally {await rm(root,{recursive:true,force:true})}
});

test('historical packing is deterministic and a failed pack permits a clean retry',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wasmfyi-history-packing-'));
  try {
    const bundle=join(root,'source');await mkdir(join(bundle,'tools/runner'),{recursive:true});
    await writeFile(join(bundle,'tools/runner/wasmbench'),'synthetic tool bytes');
    await writeFile(join(bundle,'manifest.json'),JSON.stringify({lock:{runner_version:'fixture',runner_sha256:'a'.repeat(64),runtime_configurations:[{id:'engine'}]}}));
    const plan={id:'session',identity:'b'.repeat(64),collection:{},jobs:[]},host={name:'machine',workers:1};
    const pack=async(source,output)=>exec('python3',[join(site,'scripts/pack-history-parent.py'),'--source',source,'--output',output]);
    const options={root:join(root,'first'),bundle,profile:'timing',plan,host,env:{},packing:{format:'source-tools-tar-gzip-v1'},pack};
    await assert.rejects(retainCollectionParent({...options,pack:async(_source,output)=>{await writeFile(output,'partial archive');throw Error('interrupted pack')}}),/interrupted pack/);
    await assert.rejects(access(join(options.root,'bundle.tar.gz')));
    await retainCollectionParent(options);await retainCollectionParent({...options,root:join(root,'second')});
    const first=await verifyParentBundle(join(root,'first/bundle'),{...plan,machine:host.name}),second=await verifyParentBundle(join(root,'second/bundle'),{...plan,machine:host.name});
    assert.equal(first.sha256,second.sha256);assert.deepEqual(first.parts,second.parts);
  } finally {await rm(root,{recursive:true,force:true})}
});
