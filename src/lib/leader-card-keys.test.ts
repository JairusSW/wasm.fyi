import {readFileSync} from 'node:fs';
import {parse} from 'svelte/compiler';
import {it,expect} from 'vitest';

it('expanded ranking cards keep distinct configurations with the same visible labels',()=>{
 const source=readFileSync(new URL('./components/LeaderCards.svelte',import.meta.url),'utf8');
 let key:{start:number;end:number}|undefined;
 function visit(value:unknown){
  if(!value||typeof value!=='object')return;
  const node=value as {type?:string;expression?:{start:number;end:number};key?:{start:number;end:number}};
  if(node.type==='EachBlock'&&node.expression&&source.slice(node.expression.start,node.expression.end).startsWith('l.places.slice'))key=node.key;
  for(const child of Object.values(value))if(Array.isArray(child))child.forEach(visit);else if(child&&typeof child==='object')visit(child);
 }
 visit(parse(source,{modern:true}));
 expect(key).toBeDefined();
 const getKey=new Function('p','return ('+source.slice(key!.start,key!.end)+')');
 const places=['wizard-fast-int','wizard-v3-int'].map(id=>({who:{id,rt:'wizard',be:'interpreter'}}));
 expect(new Set(places.map(p=>getKey(p))).size).toBe(places.length);
});
