#!/usr/bin/env node
// Regression checks mutate disposable copies only, never the retained fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(base,'../../..');
const tool=process.argv[2]??process.env.WASMBENCH_WASM_TOOLS??'wasm-tools';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'positive-runner-tests-'));
let checks=0;
try {
  function sandbox(name) {
    const dir=path.join(temp,name);
    fs.mkdirSync(path.join(dir,'scripts'),{recursive:true});
    fs.cpSync(base,path.join(dir,'corpora/features/upstream'),{recursive:true});
    fs.copyFileSync(path.join(root,'scripts/feature-upstream-spec.mjs'),path.join(dir,'scripts/feature-upstream-spec.mjs'));
    return dir;
  }
  function mutate(dir,id,from,to,repin) {
    const upstream=path.join(dir,'corpora/features/upstream');
    const indexPath=path.join(upstream,'index.json'),index=JSON.parse(fs.readFileSync(indexPath));
    const row=index.sources.find(s=>s.id===id),file=path.join(upstream,row.localPath);
    const before=fs.readFileSync(file,'utf8');assert(before.includes(from));
    const after=before.replace(from,to);fs.writeFileSync(file,after);
    if(repin){row.localSha256=crypto.createHash('sha256').update(after).digest('hex');fs.writeFileSync(indexPath,JSON.stringify(index));}
  }
  function run(dir) {
    const r=spawnSync(process.execPath,[path.join(dir,'scripts/feature-upstream-spec.mjs'),'--wasm-tools='+tool,'--require-all'],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
    assert.equal(r.status,1,'A tampered fixture must fail');
    return JSON.parse(r.stdout);
  }
  const integrity=sandbox('integrity');
  mutate(integrity,'fac','7034535277573963776','7034535277573963777',false);
  assert.match(run(integrity).error,/Local digest mismatch/);checks++;
  const scalar=sandbox('scalar');
  mutate(scalar,'fac','7034535277573963776','7034535277573963777',true);
  const scalarReport=run(scalar);
  assert.equal(scalarReport.status,'failed');assert.equal(scalarReport.counts.failed,1);
  assert.match(scalarReport.sources.find(s=>s.id==='fac').results.find(r=>r.status==='failed').reason,/Oracle mismatch/);checks++;
  const vector=sandbox('vector');
  mutate(vector,'relaxed-simd-relaxed_dot_product','1 13 41 85 145 221 313 421','1 13 41 85 145 221 313 422',true);
  const vectorReport=run(vector);
  assert.equal(vectorReport.status,'failed');assert.equal(vectorReport.counts.failed,1);
  assert.match(vectorReport.sources.find(s=>s.id==='relaxed-simd-relaxed_dot_product').results.find(r=>r.status==='failed').reason,/Wasm-side exact upstream oracle mismatch/);checks++;
  console.log(JSON.stringify({status:'passed',checks,scope:'digest mismatch, scalar oracle failure, full-vector oracle failure'}));
} finally {fs.rmSync(temp,{recursive:true,force:true});}
