import type {MachineId} from './data/types';

type Visitor = {
 userAgent:string;
 platform?:string;
 userAgentData?:{getHighEntropyValues?:(hints:string[])=>Promise<{architecture?:string}>};
};

export async function preferredMachine(visitor:Visitor, timeoutMs=500):Promise<MachineId> {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const hints=visitor.userAgentData?.getHighEntropyValues?.(['architecture']);
  if(hints){
   const value=await Promise.race([hints,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs)})]);
   const arch=value?.architecture?.toLowerCase()||'';
   if(/^(arm|aarch64)/.test(arch))return 'm2';
   if(/^(x86|amd64|x64)/.test(arch))return 'm1';
  }
 }catch {/* Browser privacy settings may withhold architecture. */}
 finally {if(timer)clearTimeout(timer)}
 // Safari hides Mac CPU architecture; use Apple as its platform default.
 return /arm|aarch64|iphone|ipad|android|macintosh|macintel/i.test(visitor.userAgent+' '+(visitor.platform||''))?'m2':'m1';
}
