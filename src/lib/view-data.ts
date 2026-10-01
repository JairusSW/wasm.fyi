import input from './data/measurements.json';
import type { Bench, CfgId, MachineId, MetricKey, Status } from './data/types';

export interface ViewCell {
	st: Status; v?: number; interval?: [number,number]; reason?: number;
	report: string; launchMedians?: number[];
}
interface Host {
	label: string; os: string; policy: Record<string,string>;
	configurations: Partial<Record<CfgId,{runtime:string;version:string;backend:string}>>;
	snapshots: Record<'s1'|'s2',Record<string,ViewCell>>;
}
interface ViewData {
	schema: number; catalogue: Bench[]; hosts: Record<MachineId,Host>; reasons:string[];
	reports: Record<string,{runId:string;created:string;evidence:string;sha256:string;options:Record<string,unknown>}>;
}
type PackedCell = [number,number,number,number,number,number|null,[number,number]|null,number[]|null,number|null];
interface PackedData extends Omit<ViewData,'hosts'> {
	encoding:string; metrics:string[]; statuses:Status[]; reportIds:string[];
	hosts:Record<MachineId,Omit<Host,'snapshots'> & {snapshots:Record<'s1'|'s2',PackedCell[]>}>;
}
const packed=input as unknown as PackedData;
if(packed.encoding !== 'indexed-cells-v1')throw new Error('Unsupported measured view encoding');
const slots=Object.keys((input as any).configurations) as CfgId[];
const hosts={} as Record<MachineId,Host>;
for(const machine of ['m1','m2'] as const) {
	const host=packed.hosts[machine];
	const snapshots={} as Host['snapshots'];
	for(const snapshot of ['s1','s2'] as const) {
		snapshots[snapshot]=Object.fromEntries(host.snapshots[snapshot].map(([w,c,m,st,report,v,interval,launchMedians,reason])=>[
			`${packed.catalogue[w].id}|${slots[c]}|${packed.metrics[m]}`,
			{st:packed.statuses[st],report:packed.reportIds[report],...(v==null?{}:{v}),...(interval==null?{}:{interval}),...(launchMedians==null?{}:{launchMedians}),...(reason==null?{}:{reason})}
		]));
	}
	hosts[machine]={...host,snapshots};
}
export const viewData:ViewData={...packed,hosts};
export function viewCell(machine: MachineId, snapshot:'s1'|'s2', workload:string, config:CfgId, metric:MetricKey): ViewCell {
	return viewData.hosts[machine].snapshots[snapshot][`${workload}|${config}|${metric}`] || {st:'nm',report:''};
}
export const viewReason = (cell:ViewCell) => cell.reason == null ? '' : viewData.reasons[cell.reason];
