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
	configurations:Record<CfgId,string>;
	statistics:{timingSamples:number};
	history:Record<MachineId,{
		points:{date:string;revision:string;collectedAt?:string;status:string}[];
		workloads:string[];versions:Record<CfgId,string[]>;
		cells:Record<string,(ViewCell & {role:'retrospective-revision'|'fixed-comparison-baseline'})[]>;
	}>;
	reports: Record<string,{runId:string;created:string;evidence:string;sha256:string;options:Record<string,unknown>;configurations:string[];host:string}>;
}
type PackedCell = [number,number,number,number,number,number|null,[number,number]|null,number[]|null,number|null];
type PackedHistoryCell=[number,number,number|null,[number,number]|null,number[]|null,number|null];
interface PackedData extends Omit<ViewData,'hosts'|'history'> {
	encoding:string; metrics:string[]; statuses:Status[]; reportIds:string[];
	hosts:Record<MachineId,Omit<Host,'snapshots'> & {snapshots:Record<'s1'|'s2',PackedCell[]>}>;
	history:Record<MachineId,Omit<ViewData['history'][MachineId],'cells'> & {cells:Record<string,PackedHistoryCell[]>}>;
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
const history={} as ViewData['history'];
for(const machine of ['m1','m2'] as const) {
	const source=packed.history[machine];
	history[machine]={...source,cells:Object.fromEntries(Object.entries(source.cells).map(([key,points])=>[key,points.map(([st,report,v,interval,launchMedians,reason])=>({
		st:packed.statuses[st],report:packed.reportIds[report] || '',role:key.split('|').at(-2)==='G'?'retrospective-revision' as const:'fixed-comparison-baseline' as const,
		...(v==null?{}:{v}),...(interval==null?{}:{interval}),...(launchMedians==null?{}:{launchMedians}),...(reason==null?{}:{reason})
	}))]))};
}
export const viewData:ViewData={...packed,hosts,history};
export function viewCell(machine: MachineId, snapshot:'s1'|'s2', workload:string, config:CfgId, metric:string): ViewCell {
	return viewData.hosts[machine].snapshots[snapshot][`${workload}|${config}|${metric}`] || {st:'nm',report:''};
}
export const viewReason = (cell:ViewCell) => cell.reason == null ? '' : viewData.reasons[cell.reason];
