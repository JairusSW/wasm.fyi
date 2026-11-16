import type {ViewData,Host} from './view-contract';
import {MACHINE_NAMES} from './machine-label';
const host=(label:string):Host=>({label,os:'not collected',policy:{},configurations:{},snapshots:{s1:{},s2:{}}});
const history=()=>({points:[],workloads:[],artifactSha256:{},versions:{} as ViewData['history']['m1']['versions'],cells:{}});
const threads=()=>({created:'',configuration:'',node:'',v8:'',policy:'',evidence:'',sha256:'',results:[]});
export function emptyView():ViewData{return {schema:3,catalogue:[],applicationConfigurations:[],configurations:{} as ViewData['configurations'],hosts:{m1:host(MACHINE_NAMES.m1),m2:host(MACHINE_NAMES.m2),m3:host(MACHINE_NAMES.m3)},history:{m1:history(),m2:history(),m3:history()},reports:{},reasons:[],threads:{m1:threads(),m2:threads(),m3:threads()},statistics:{timingSamples:null},featureVersions:{m1:[],m2:[],m3:[]}}}
// Measurements are published atomically; proxying every cell and sample makes
// large read-only calculations unnecessarily expensive.
class DatasetView {
 current=$state.raw(emptyView());
 machine=$state<import('../data/types').MachineId>('m1');
 revision=$state('');
 loading=$state(false);
 error=$state('');
 generation=$state(0);
}
export const datasetView=new DatasetView();
// Existing read-only consumers get scoped data. No measurement JSON is imported.
export const viewData:ViewData=new Proxy({} as ViewData,{get:(_,key)=>Reflect.get(datasetView.current,key)});
