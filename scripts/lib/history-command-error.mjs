import {openSync,closeSync,fstatSync,readSync} from 'node:fs';

// Record only this invocation's final output, never a preceding pin's failure.
export function historyCommandError(program,code,path,start=0) {
 let output='';
 try {
  const fd=openSync(path,'r');
  try {
   const end=fstatSync(fd).size,offset=Math.max(start,end-16384);
   const bytes=Buffer.alloc(Math.max(0,end-offset));
   readSync(fd,bytes,0,bytes.length,offset);output=bytes.toString('utf8').trim();
  } finally {closeSync(fd);}
 } catch {}
 return Error(program+' exited '+code+(output?'\n'+output:''));
}
