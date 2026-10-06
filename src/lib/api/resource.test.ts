import {it,expect,vi} from 'vitest';
import {assembleJSONResource} from './resource';
import type {JSONResource,JSONFragment} from './types';
async function fixture(){
 const text=JSON.stringify({message:'λ 🦀 \\ "'.repeat(40000)}),bytes=new TextEncoder().encode(text);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const chunks:JSONFragment[]=[];for(let start=0;start<text.length;start+=20000)chunks.push({kind:'json-fragment',schema:1,text:text.slice(start,start+20000)});
 const references=chunks.map((_,i)=>i.toString(16).padStart(64,'0'));
 const resource:JSONResource={kind:'json-resource',schema:1,encoding:'json-utf8',bytes:bytes.length,sha256,references};
 return {text,chunks,resource,read:vi.fn(async(digest:string)=>chunks[references.indexOf(digest)])};
}
it('explicitly assembles exact JSON across escape and unicode boundaries',async()=>{
 const f=await fixture();expect(f.read).not.toHaveBeenCalled();expect(await assembleJSONResource(f.resource,f.read)).toEqual(JSON.parse(f.text));expect(f.read).toHaveBeenCalledTimes(f.chunks.length);
});
it('rejects tampered hashes, oversized counts and canceled evidence assembly',async()=>{
 const f=await fixture();await expect(assembleJSONResource({...f.resource,sha256:'a'.repeat(64)},f.read)).rejects.toThrow('hash');
 await expect(assembleJSONResource({...f.resource,bytes:64*1024*1024+1},f.read)).rejects.toThrow('Invalid');
 const controller=new AbortController();controller.abort();const read=vi.fn(async(digest:string)=>f.read(digest));
 await expect(assembleJSONResource(f.resource,read,controller.signal)).rejects.toThrow();expect(read).not.toHaveBeenCalled();
});
