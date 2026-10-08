type Pending = {controller:AbortController;promise:Promise<unknown>;users:number};
/** Concurrent consumers share a fetch; cancellation belongs to each consumer. */
export class RequestPool {
 private pending=new Map<string,Pending>();
 async load<T>(key:string,fetcher:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();
  let entry=this.pending.get(key);
  if(!entry){
   const controller=new AbortController();
   const promise=fetcher(controller.signal).finally(()=>{if(this.pending.get(key)?.controller===controller)this.pending.delete(key)});
   entry={controller,promise,users:0};this.pending.set(key,entry);
   void promise.catch(()=>{});
  }
  const active=entry;active.users++;
  try{
   if(!signal)return await active.promise as T;
   return await new Promise<T>((resolve,reject)=>{
    const abort=()=>{cleanup();reject(signal.reason)};
    const cleanup=()=>signal.removeEventListener('abort',abort);
    signal.addEventListener('abort',abort,{once:true});
    active.promise.then(value=>{cleanup();resolve(value as T)},error=>{cleanup();reject(error)});
    if(signal.aborted)abort();
   });
  }finally{
   active.users--;
   if(active.users===0&&this.pending.get(key)===active){this.pending.delete(key);active.controller.abort()}
  }
 }
}
