// Both uploads and contract registrations are idempotent. Respect the existing
// publisher budget rather than failing a large corpus halfway through.
export async function artifactUpload(url,init,{request=fetch,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;;attempt++){
  const response=await request(url,{...init,redirect:'error',signal:AbortSignal.timeout(60000)});
  if([429,503].includes(response.status)&&attempt<5){
   const retry=Number(response.headers.get('Retry-After'));await response.arrayBuffer();
   await delay(retry>0?Math.min(retry,10)*1000:1000);continue;
  }
  if(!response.ok)throw Error('Artifact publication HTTP '+response.status+': '+(await response.text()).slice(0,512));
  await response.arrayBuffer();return;
 }
}
