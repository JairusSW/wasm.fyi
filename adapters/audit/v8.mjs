import{readFileSync}from'node:fs';
for(const path of process.argv.slice(2)){
 const bytes=readFileSync(path),held=new WebAssembly.Module(bytes),times=[];
 for(let i=0;i<30;i++){const start=process.hrtime.bigint();const module=new WebAssembly.Module(bytes);times.push(Number(process.hrtime.bigint()-start));if(!module)throw Error('Missing compiled module');}
 times.sort((a,b)=>a-b);console.log(JSON.stringify({artifact:path,flags:process.execArgv,bytes:bytes.length,medianNs:times[15],samplesNs:times,held:!!held}));
}
