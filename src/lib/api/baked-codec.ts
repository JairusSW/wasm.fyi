import type {BakedPageSeed} from './page-seed';
import type {ViewCell} from './view-contract';
// Intern repeated metadata and cells before embedding the snapshot in HTML.
// Each compound value refers only to earlier entries, so decoding is linear.
// Entry kinds: [0,...ids] array, [1,key,value,...] object, [2,...] literal numbers.
type Entry=null|boolean|number|string|(number|null)[];
// Matrix cells are stored by column: one id per cell for each common field,
// -1 where a cell lacks it. Rare fields keep a sparse [cell, object] list.
const COLUMNS=['st','report','observationId','platformId','asOf','v'] as const;
const RAW=new Set<string>(['observationId','v']);
type PackedCells={n:number;key:[number[],number[],number[]];columns:Record<string,(number|null)[]>;rest:[number,unknown][]};
// Reports synthesized from loaded rows carry nothing beyond their id.
const syntheticReport=(id:string,host:string)=>{const at=id.indexOf('|');return {runId:id,created:id.slice(0,at),evidence:'',sha256:'',options:{},codeRecords:[],configurations:[id.slice(at+1)],host}};
export function encodeBakedSeed(seed:BakedPageSeed):string{
 const values:Entry[]=[],known=new Map<string,number>();
 function intern(entry:Entry):number{
  const key=JSON.stringify(entry),previous=known.get(key);
  if(previous!==undefined)return previous;
  const id=values.length;values.push(entry);known.set(key,id);return id;
 }
 function add(value:unknown):number{
  if(value instanceof Float64Array)return intern([2,...Array.from(value)]);
  if(Array.isArray(value))return intern([0,...value.map(add)]);
  if(value!==null&&typeof value==='object')return intern([1,...Object.entries(value).filter(([,v])=>v!==undefined).flatMap(([k,v])=>[add(k),add(v)])]);
  return intern(value as null|boolean|number|string);
 }
 // Literal number columns; null marks a missing value.
 const literal=(list:(number|null)[])=>({literal:list});
 function packCells(cells:Record<string,ViewCell>){
  const entries=Object.entries(cells),parts:[number[],number[],number[]]=[[],[],[]];
  const columns:Record<string,(number|null)[]>=Object.fromEntries(COLUMNS.map(c=>[c,[]])),rest:[number,unknown][]=[];
  entries.forEach(([key,cell],i)=>{
   const [workload,config,metric]=key.split('|');parts[0].push(add(workload));parts[1].push(add(config));parts[2].push(add(metric));
   const record=cell as unknown as Record<string,unknown>;
   for(const column of COLUMNS){const v=record[column];columns[column].push(v===undefined?(RAW.has(column)?null:-1):RAW.has(column)?v as number:add(v))}
   const other=Object.fromEntries(Object.entries(record).filter(([k,v])=>v!==undefined&&!(COLUMNS as readonly string[]).includes(k)));
   if(Object.keys(other).length)rest.push([i,other]);
  });
  return {n:entries.length,key:parts.map(literal),columns:Object.fromEntries(Object.entries(columns).map(([k,v])=>[k,literal(v)])),rest};
 }
 const hosts=Object.fromEntries(Object.entries(seed.view.hosts).map(([machine,host])=>[machine,{...host,snapshots:Object.fromEntries(Object.entries(host.snapshots).map(([snapshot,cells])=>[snapshot,packCells(cells)]))}]));
 const synthetic:string[]=[],reports:Record<string,unknown>={};
 for(const [id,report] of Object.entries(seed.view.reports)){
  const host=(report as {host?:string}).host||'';
  if(id.includes('|')&&JSON.stringify(report)===JSON.stringify(syntheticReport(id,host)))synthetic.push(host+'\n'+id);else reports[id]=report;
 }
 const packed={...seed,view:{...seed.view,hosts,reports,syntheticReports:synthetic}};
 // Literal columns become kind-2 entries instead of one entry per number.
 const root=add(JSON.parse(JSON.stringify(packed),(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)&&Array.isArray(v.literal)&&Object.keys(v).length===1?new Float64Array(v.literal.map((x:number|null)=>x??NaN)):v));
 return JSON.stringify({root,values},(_,v)=>typeof v==='number'&&Number.isNaN(v)?null:v);
}
export function decodeBakedSeed(text:string):BakedPageSeed{
 const {root,values}=JSON.parse(text) as {root:number;values:Entry[]};
 const decoded:unknown[]=[];
 for(const entry of values){
  if(!Array.isArray(entry)){decoded.push(entry);continue}
  if(entry[0]===0)decoded.push(entry.slice(1).map(id=>decoded[id as number]));
  else if(entry[0]===2)decoded.push(entry.slice(1));
  else{const pairs:[string,unknown][]=[];for(let i=1;i<entry.length;i+=2)pairs.push([decoded[entry[i] as number] as string,decoded[entry[i+1] as number]]);decoded.push(Object.fromEntries(pairs))}
 }
 const seed=decoded[root] as BakedPageSeed&{view:{syntheticReports?:string[]}};
 const unpack=(packed:PackedCells|[string,string,string,ViewCell][])=>{
  // Snapshots written before the columnar layout list [workload,config,metric,cell].
  if(Array.isArray(packed))return Object.fromEntries(packed.map(([workload,config,metric,cell])=>[`${workload}|${config}|${metric}`,cell]));
  const cells:Record<string,ViewCell>={},[w,c,m]=packed.key,rest=new Map(packed.rest);
  for(let i=0;i<packed.n;i++){
   const cell:Record<string,unknown>={};
   for(const column of COLUMNS){const id=packed.columns[column][i];if(RAW.has(column)){if(id!=null)cell[column]=id}else if(id!=null&&id>=0)cell[column]=decoded[id]}
   const other=rest.get(i);if(other)Object.assign(cell,other);
   cells[`${decoded[w[i]]}|${decoded[c[i]]}|${decoded[m[i]]}`]=cell as unknown as ViewCell;
  }
  return cells;
 };
 const hosts=Object.fromEntries(Object.entries(seed.view.hosts).map(([machine,host])=>[machine,{...host,snapshots:Object.fromEntries(Object.entries(host.snapshots).map(([snapshot,cells])=>[snapshot,unpack(cells as unknown as PackedCells)]))}])) as typeof seed.view.hosts;
 const {syntheticReports=[],...view}=seed.view;
 const reports={...view.reports};
 for(const item of syntheticReports){const at=item.indexOf('\n'),host=item.slice(0,at),id=item.slice(at+1);reports[id]=syntheticReport(id,host) as unknown as typeof reports[string]}
 return {...seed,view:{...view,hosts,reports}};
}
