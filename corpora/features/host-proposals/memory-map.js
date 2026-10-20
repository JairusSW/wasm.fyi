// Native anonymous mapping subset. File-backed mapping is tested separately by
// the complete upstream memory-control.js and can be unavailable on a platform.
const name=arguments[0];
function check(x){if(!x)throw Error('Memory map oracle failed: '+name);}
if(typeof WebAssembly.MemoryMapDescriptor!=='function')throw Error('Native memory-map API unavailable');
const descriptor=new WebAssembly.MemoryMapDescriptor(65536);
const memory=new WebAssembly.Memory({initial:3});
descriptor.map(memory,65536);
let mapped=true;
function unmap(){descriptor.unmap();mapped=false;}
const bytes=new Uint8Array(memory.buffer);
if(name==='zero-initialization')check(bytes.slice(65536,131072).every(x=>x===0));
else if(name==='mapped-write') {bytes[65536+17]=173;check(bytes[65536+17]===173);}
else if(name==='unmap-zero') {bytes[65536+17]=173;unmap();check(bytes[65536+17]===0);}
else if(name==='adjacent-preserved') {bytes[17]=97;unmap();check(bytes[17]===97);}
else if(name==='remap-data') {bytes[65536+17]=173;unmap();descriptor.map(memory,131072);mapped=true;check(bytes[131072+17]===173);}
else throw Error('Unknown memory-map case');
if(mapped)unmap();
print(JSON.stringify({case:name,status:'verified'}));
