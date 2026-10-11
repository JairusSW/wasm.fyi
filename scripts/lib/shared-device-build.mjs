// SDK builds share the user's device reservation but may use all CPU cores.
import {fileURLToPath} from 'node:url';
export function reservedBuildCommand(program,args,options={}) {
 if(process.platform!=='darwin'||(options.env||process.env).WASMBENCH_SHARED_DEVICE_RESERVED==='1'||args.some(arg=>String(arg).endsWith('benchmark-history-worker.mjs')))return {program,args,options};
 const coordinator=fileURLToPath(new URL('../shared-device-run.py',import.meta.url));
 return {program:'python3',args:[coordinator,'--','env','WASMBENCH_SHARED_DEVICE_RESERVED=1',program,...args],options};
}
