export {viewData} from './api/view.svelte';
export type {ViewData,Host,ViewCell} from './api/view-contract';
import {viewData} from './api/view.svelte';
import type {ViewCell} from './api/view-contract';
import type {MachineId,CfgId} from './data/types';
export function viewCell(machine:MachineId,snapshot:'s1'|'s2',workload:string,config:CfgId,metric:string):ViewCell {
 return viewData.hosts[machine].snapshots[snapshot][`${workload}|${config}|${metric}`]||{st:'nm',report:''};
}
export const viewReason=(cell:ViewCell)=>cell.reasonText||(cell.reason==null?'':viewData.reasons[cell.reason]||'');
