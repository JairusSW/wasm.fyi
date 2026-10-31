import type {BakedPageSeed} from './page-seed';
// Intern repeated metadata and cells before embedding the snapshot in HTML.
// Each compound value refers only to earlier entries, so decoding is linear.
type Entry=null|boolean|number|string|number[];
export function encodeBakedSeed(seed:BakedPageSeed):string{
 const values:Entry[]=[],known=new Map<string,number>();
 function add(value:unknown):number{
  let entry:Entry;
  if(Array.isArray(value))entry=[0,...value.map(add)];
  else if(value!==null&&typeof value==='object')entry=[1,...Object.entries(value).filter(([,v])=>v!==undefined).flatMap(([k,v])=>[add(k),add(v)])];
  else entry=value as null|boolean|number|string;
  const key=JSON.stringify(entry),previous=known.get(key);
  if(previous!==undefined)return previous;
  const id=values.length;values.push(entry);known.set(key,id);return id;
 }
 const packed={...seed,view:{...seed.view,hosts:Object.fromEntries(Object.entries(seed.view.hosts).map(([machine,host])=>[machine,{...host,snapshots:Object.fromEntries(Object.entries(host.snapshots).map(([snapshot,cells])=>[snapshot,Object.entries(cells).map(([key,cell])=>[...key.split('|'),cell])]))}]))}};
 const root=add(packed);return JSON.stringify({root,values});
}
export function decodeBakedSeed(text:string):BakedPageSeed{
 const {root,values}=JSON.parse(text) as {root:number;values:Entry[]};
 const decoded:unknown[]=[];
 for(const entry of values){
  if(!Array.isArray(entry)){decoded.push(entry);continue}
  if(entry[0]===0)decoded.push(entry.slice(1).map(id=>decoded[id]));
  else{const pairs:[string,unknown][]=[];for(let i=1;i<entry.length;i+=2)pairs.push([decoded[entry[i]] as string,decoded[entry[i+1]]]);decoded.push(Object.fromEntries(pairs))}
 }
 const seed=decoded[root] as BakedPageSeed;
 const hosts=Object.fromEntries(Object.entries(seed.view.hosts).map(([machine,host])=>[machine,{...host,snapshots:Object.fromEntries(Object.entries(host.snapshots).map(([snapshot,cells])=>{
  const rows=cells as unknown as [string,string,string,import('./view-contract').ViewCell][];
  return [snapshot,Object.fromEntries(rows.map(([workload,config,metric,cell])=>[`${workload}|${config}|${metric}`,cell]))];
 }))}])) as typeof seed.view.hosts;
 return {...seed,view:{...seed.view,hosts}};
}
