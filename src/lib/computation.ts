/** Yield to browser input and painting, rather than only draining microtasks. */
export function computationCheckpoint(signal?:AbortSignal) {
 let start=performance.now(),rows=0;
 return ():Promise<void>|undefined=>{
  signal?.throwIfAborted();
  if(++rows<256 && performance.now()-start<8)return;
  rows=0;
  return new Promise<void>(resolve=>setTimeout(resolve,0)).then(()=>{
   signal?.throwIfAborted();start=performance.now();
  });
 };
}
