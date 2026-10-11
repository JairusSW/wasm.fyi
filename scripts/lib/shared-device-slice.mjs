import {readFile,stat} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
export function remainingSharedDeviceSliceMs(ownedSeconds=0){
 if(typeof ownedSeconds!=='number'||!Number.isFinite(ownedSeconds)||ownedSeconds<0)throw Error('Invalid shared device ownedSeconds');
 return Math.max(0,30*60-ownedSeconds)*1000;
}
export async function sharedDeviceSliceMs(directory,env=process.env){
 let path=env.WASMBENCH_SHARED_DEVICE_SCHEDULE;
 if(!path){let current=resolve(directory);for(;;){if(await stat(join(current,'source-plan.json')).catch(()=>null)&&await stat(join(current,'collection-template.json')).catch(()=>null)){path=join(current,'device-schedule.json');break;}const parent=dirname(current);if(parent===current)break;current=parent;}}
 if(!path)return remainingSharedDeviceSliceMs();
 let schedule;try{schedule=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return remainingSharedDeviceSliceMs();throw error;}
 return remainingSharedDeviceSliceMs(schedule.ownedSeconds??0);
}
