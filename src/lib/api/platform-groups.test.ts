import {it,expect} from 'vitest';
import {platformGroups} from './platform-groups';
import type {PlatformChoice} from './benchmark-types';
const host=(id:string,cpu:string,arch:string,memoryBytes?:number):PlatformChoice=>({id,cpu,arch,os:arch==='arm64'?'darwin':'linux',kernel:'test',cores:8,memoryBytes});
it('keeps both AMD64 machines and preserves earlier platform metadata for history',()=>{
 const groups=platformGroups([
  host('arm-old','Apple M4 Max','arm64'),host('hub','AMD Ryzen 7 7800X3D','amd64'),
  host('remote','AMD Ryzen 9 5950X','amd64'),host('arm-current','Apple M4 Max','arm64',64*1024**3)
 ]);
 expect(groups.map(g=>g.machine)).toEqual(['m2','m1','m3']);
 expect(groups[0].platforms.map(p=>p.id)).toEqual(['arm-current','arm-old']);
 expect(groups.flatMap(g=>g.platforms)).toHaveLength(4);
});

it('uses the current Hub environment for aggregate cards even when an older kernel reports more RAM',()=>{
 const previous={...host('hub-beta12','AMD Ryzen 7 7800X3D','amd64',32710246400),capturedAt:'2026-10-12T17:08:28.810Z'};
 const current={...host('hub-beta13','AMD Ryzen 7 7800X3D','amd64',32710213632),capturedAt:'2026-10-16T01:01:28.707Z'};
 for(const inputs of [[previous,current],[current,previous]]){
  expect(platformGroups(inputs)[0].platforms.map(p=>p.id)).toEqual(['hub-beta13','hub-beta12']);
 }
});
