import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Only recover the public numeric signature. The engine validates all types
// and instructions before this reader runs; compound internal types are skipped.
export function shellNumericSignature(data,name,unsupported=message=>{throw Error(message)}){
 let pos=8,limit=data.length;const types=[],functions=[];let target;
 const byte=()=>{if(pos>=limit)throw Error('truncated Wasm');return data[pos++]};
 const uint=()=>{let n=0;for(let i=0;i<5;i++){const b=byte();if(i===4&&b>15)throw Error('invalid u32');n+=(b&127)*2**(7*i);if(b<128)return n}throw Error('invalid u32')};
 const count=()=>{const n=uint();if(n>limit-pos)throw Error('invalid vector');return n};
 const vector=fn=>Array.from({length:count()},fn);
 const text=()=>vector(byte).map(x=>String.fromCharCode(x)).join('');
 const heap=()=>{for(let i=0;i<5;i++)if(byte()<128)return;throw Error('invalid heap type')};
 const value=()=>{const tag=byte();if(tag===0x63||tag===0x64)heap();return tag};
 const field=()=>{value();byte()};
 const subtype=first=>{
  let tag=first===undefined?byte():first;
  if(tag===0x4f||tag===0x50){for(let n=count();n>0;n--)uint();tag=byte()}
  if(tag===0x65)tag=byte();
  if(tag===0x60){types.push({params:vector(value),results:vector(value)});return}
  if(tag===0x5f){for(let n=count();n>0;n--)field()}
  else if(tag===0x5e)field();
  else if(tag===0x5d)uint();
  else unsupported('adapter cannot read this compound type encoding');
  types.push(null);
 };
 if(data.length<8||data.slice(0,8).some((x,i)=>x!==[0,97,115,109,1,0,0,0][i]))unsupported('core Wasm binary required');
 while(pos<data.length){
  limit=data.length;const id=byte(),length=uint(),end=pos+length;
  if(end>data.length)throw Error('truncated section');limit=end;
  if(id===1)for(let n=count();n>0;n--){const tag=byte();if(tag===0x4e){for(let m=count();m>0;m--)subtype()}else subtype(tag)}
  if(id===2)for(let n=count();n>0;n--){
   const module=text(),importName=text(),kind=byte();if(kind!==0)unsupported('host imports must be functions');
   const typeIndex=uint(),t=types[typeIndex];
   const identity=module==='wasmbench'&&importName==='identity'&&t?.params.length===1&&t.params[0]===127&&t.results.length===1&&t.results[0]===127;
   const abort=module==='env'&&importName==='abort'&&t?.params.length===4&&t.params.every(x=>x===127)&&t.results.length===0;
   if(!identity&&!abort)unsupported('host import name or signature mismatch');functions.push(typeIndex);
  }
  if(id===3)for(let n=count();n>0;n--)functions.push(uint());
  if(id===7)for(let n=count();n>0;n--){const exportName=text(),kind=byte(),index=uint();if(exportName===name&&kind===0)target=index}
  pos=end;
 }
 const signature=types[functions[target]];
 if(!signature||!signature.params.every(type=>type===127||type===126)||!signature.results.every(type=>type===127||type===126))unsupported('i32/i64 function signature required');
 return signature;
}

const marker='// wasm-fyi compound Wasm signature reader v1';
export function withShellCompoundSignature(source){
 if(source.includes(marker))return source;
 const start=source.indexOf('  // Read just numeric function signatures;'),end=source.indexOf('  function canonical(value)',start);
 if(start<0||end<0)throw Error('Shell numeric signature seam changed');
 return source.slice(0,start)+'  '+marker+'\n'+shellNumericSignature.toString()+'\n  function numericSignature(data,name){return shellNumericSignature(data,name,unsupported)}\n'+source.slice(end);
}
export async function applyShellCompoundSignature(root){
 const path=join(root,'adapters/js-shell/adapter.js');
 const before=await readFile(path,'utf8'),after=withShellCompoundSignature(before);
 if(after!==before)await writeFile(path,after);
}
