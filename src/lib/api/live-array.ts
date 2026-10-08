/** Read-only catalog views recompute from the current scoped reactive data. */
export function liveArray<T>(read:()=>T[]):T[]{
 return new Proxy([] as T[],{
  get:(_,key)=>{const values=read();const value=Reflect.get(values,key);return typeof value==='function'?value.bind(values):value},
  has:(_,key)=>Reflect.has(read(),key),
  ownKeys:()=>Reflect.ownKeys(read()),
  getOwnPropertyDescriptor:(_,key)=>key==='length'?{value:read().length,writable:true,enumerable:false,configurable:false}:Reflect.getOwnPropertyDescriptor(read(),key),
  set:()=>{throw new Error('Catalog views are read-only')}
 });
}
