export function benchmarkAPIOrigin(value){
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('API URL must be an origin without credentials');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use HTTPS except for a local API');
 return url.origin;
}
export async function publishCapture({url,token,capture,signal,request=fetch,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 url=benchmarkAPIOrigin(url);
 if(typeof token!=='string'||token.length<32)throw Error('Capture publication requires a publisher token');
 const body=JSON.stringify(capture);if(Buffer.byteLength(body)>1024*1024)throw Error('Capture exceeds the API 1 MiB limit');
 for(let attempt=0;;attempt++){
 const response=await request(url+'/api/captures',{method:'POST',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body});
 const data=await response.json().catch(()=>null);
 if((response.status===429||response.status===503)&&attempt<5){const seconds=Number(response.headers.get('Retry-After'));await delay(Number.isFinite(seconds)&&seconds>0?Math.min(seconds,10)*1000:1000);signal?.throwIfAborted();continue;}
 if(!response.ok)throw Error(`Capture publication failed: HTTP ${response.status}${data?.error?.code?' '+data.error.code:''}${data?.error?.message?': '+data.error.message:''}`);
 if(response.status!==200||!data||typeof data.id!=='string'||!/^[a-f0-9]{64}$/.test(data.id))throw Error('Capture publication returned an invalid durable receipt');
 return data;
 }
}
