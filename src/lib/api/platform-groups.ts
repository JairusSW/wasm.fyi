import type {PlatformChoice} from './benchmark-types';
import type {MachineId} from '../data/types';

// A kernel update can slightly change reported RAM. Aggregate endpoints use the
// first environment, so prefer the one with the most recent captures; keep older
// environments available for merged tables and history.
type CapturedPlatform = PlatformChoice & {capturedAt?:string};
const captureTime=(p:CapturedPlatform)=>Date.parse(p.capturedAt||'')||0;
export function historyPlatforms(platforms:PlatformChoice[]){
 const host=platforms[0];
 return platforms.filter(p=>p.os===host.os&&p.arch===host.arch&&p.cpu===host.cpu&&p.cores===host.cores);
}
export function platformGroups(platforms:CapturedPlatform[]) {
 const groups=new Map<MachineId,CapturedPlatform[]>();
 for(const platform of platforms) {
  const machine:MachineId=platform.arch==='arm64'?'m2':/5950X/i.test(platform.cpu)?'m3':'m1';
  const entries=groups.get(machine)||[];entries.push(platform);groups.set(machine,entries);
 }
 return [...groups].map(([machine,platforms])=>({machine,platforms:platforms.sort((a,b)=>captureTime(b)-captureTime(a)||(b.memoryBytes||0)-(a.memoryBytes||0)||b.cores-a.cores)}));
}
