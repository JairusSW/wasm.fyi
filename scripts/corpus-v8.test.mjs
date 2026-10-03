import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkV8 } from './lib/v8-corpus.mjs';
import { site, digest } from './lib/wasmbench.mjs';
import { kernels, reference } from './lib/application-kernels.mjs';
const manifest=JSON.parse(await readFile(join(site,'corpora/features/manifest.json')));
const fixture=name=>{const w=manifest.find(w=>w.id===`features/wasi-p1/${name}-64/64`);return {...w,artifact:join(site,'corpora/features',w.artifact)};};

test('Preview 1 stdin rejects a host that reports bytes without copying them',async()=>{
  let instance;
  await assert.rejects(checkV8(fixture('stdin-read'),{repeat:1,afterInstantiate:i=>instance=i,mutateImports:imports=>{
    imports.wasi_snapshot_preview1.fd_read=(_fd,_iovs,_len,nread)=>{new DataView(instance.exports.memory.buffer).setUint32(nread,64,true);return 0;};
  }}),/unreachable|Incorrect/);
});
test('Preview 1 arguments reject a host that reports sizes but leaves strings empty',async()=>{
  let instance;
  await assert.rejects(checkV8(fixture('arguments'),{repeat:1,afterInstantiate:i=>instance=i,mutateImports:imports=>{imports.wasi_snapshot_preview1.args_get=(argv,buffer)=>{const m=new DataView(instance.exports.memory.buffer);m.setUint32(argv,buffer,true);m.setUint32(argv+4,buffer+14,true);return 0;};}}),/unreachable/);
});
test('Preview 1 fd_write rejects reported success without a byte count',async()=>{
  await assert.rejects(checkV8(fixture('fd-write'),{repeat:1,mutateImports:imports=>{imports.wasi_snapshot_preview1.fd_write=()=>0;}}),/unreachable/);
});
test('V8 checks artifact digests and exact oracles before accepting a fixture',async()=>{
  const w=fixture('stdin-read');
  await assert.rejects(checkV8({...w,sha256:'0'.repeat(64)}),/digest mismatch/);
  await assert.rejects(checkV8({...w,command:{...w.command,stdout_sha256:'0'.repeat(64)}},{repeat:1}),/Incorrect stdout/);
});
test('portable DNA and text kernels match independent references at different inputs',async()=>{
  const apps=JSON.parse(await readFile(join(site,'corpora/applications/manifest.json')));
  for(const kernel of kernels.filter(k=>k.kind>=97)) {
    const w=apps.find(w=>w.id===`applications/${kernel.id}`);
    const bytes=await readFile(join(site,'corpora/applications',w.artifact));assert.equal(digest(bytes),w.sha256);
    const instance=await WebAssembly.instantiate(await WebAssembly.compile(bytes));
    for(const size of kernel.kind<=99?[1,2,17,64,256]:[5,17,256,4096])for(let repeat=0;repeat<3;repeat++)
      assert.equal(instance.exports.benchmark(size)>>>0,reference(kernel.kind,size),`${kernel.id}/${size}`);
  }
});

test('WASI probes accept successful short reads and short writes',async()=>{
  for(const name of ['stdin-read','fd-write','scatter-write']) {
    let instance;
    const outcome=await checkV8(fixture(name),{repeat:1,afterInstantiate:i=>instance=i,mutateImports:imports=>{
      const field=name==='stdin-read'?'fd_read':'fd_write',real=imports.wasi_snapshot_preview1[field];
      imports.wasi_snapshot_preview1[field]=(fd,iovs,length,count)=>{
        const memory=new DataView(instance.exports.memory.buffer),saved=[];let chosen=false;
        for(let i=0;i<length;i++) {
          const offset=iovs+i*8+4,value=memory.getUint32(offset,true);saved.push([offset,value]);
          const take=!chosen&&value>0?1:0;chosen ||= take>0;memory.setUint32(offset,take,true);
        }
        try {return real(fd,iovs,length,count);}finally{for(const [offset,value]of saved)memory.setUint32(offset,value,true);}
      };
    }});
    assert.equal(outcome.status,'verified',name);
  }
});
