/** Read-only catalog views recompute from the current scoped reactive data. */
export function liveArray<T>(read:()=>T[], revision?:()=>unknown):T[]{
 let initialized=false,previous:unknown,values:T[]=[];
 const current=()=>{
  if(!revision)return read();
  const next=revision();
  if(!initialized||next!==previous){values=read();previous=next;initialized=true}
  return values;
 };
 return new Proxy([] as T[],{
  get:(_,key)=>{const values=current();const value=Reflect.get(values,key);return typeof value==='function'?value.bind(values):value},
  has:(_,key)=>Reflect.has(current(),key),
  ownKeys:()=>Reflect.ownKeys(current()),
  getOwnPropertyDescriptor:(_,key)=>key==='length'?{value:current().length,writable:true,enumerable:false,configurable:false}:Reflect.getOwnPropertyDescriptor(current(),key),
  set:()=>{throw new Error('Catalog views are read-only')}
 });
}
