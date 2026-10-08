import type {PlatformChoice} from './benchmark-types';
import type {MachineId} from '../data/types';

export function platformGroups(platforms:PlatformChoice[]) {
 const groups=new Map<MachineId,PlatformChoice[]>();
 for(const platform of platforms) {
  const machine:MachineId=platform.arch==='arm64'?'m2':/5950X/i.test(platform.cpu)?'m3':'m1';
  const entries=groups.get(machine)||[];entries.push(platform);groups.set(machine,entries);
 }
 return [...groups].map(([machine,platforms])=>({machine,platforms:platforms.sort((a,b)=>(b.memoryBytes||0)-(a.memoryBytes||0)||b.cores-a.cores)}));
}
