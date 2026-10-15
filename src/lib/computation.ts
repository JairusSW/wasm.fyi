// Feature-detect prioritized continuations; a timer fallback remains for SSR.
// https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield
function yieldForInput():Promise<void> {
 if(globalThis.scheduler?.yield)return globalThis.scheduler.yield();
 if(typeof window!=='undefined'&&typeof MessageChannel!=='undefined')return new Promise(resolve=>{
  const channel=new MessageChannel();
  channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve()};
  channel.port2.postMessage(null);
 });
 return new Promise(resolve=>setTimeout(resolve,0));
}
/** Yield to browser input and painting, rather than only draining microtasks. */
export function computationCheckpoint(signal?:AbortSignal) {
 let start=performance.now(),rows=0;
 return ():Promise<void>|undefined=>{
  signal?.throwIfAborted();
  if(++rows<256 && performance.now()-start<8)return;
  rows=0;
  return yieldForInput().then(()=>{
   signal?.throwIfAborted();start=performance.now();
  });
 };
}
