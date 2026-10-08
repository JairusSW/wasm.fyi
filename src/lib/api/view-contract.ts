import type { Bench, CfgId, MachineId, Status } from '../data/types';
export interface ViewCell {
	st: Status; v?: number; interval?: [number,number]; reason?: number;reasonText?:string;
	result?:string;created?:string;contract?:string;configuration?:string;artifact?:string;profile?:string;exactValue?:number|string;approximate?:boolean;
	report: string; launchMedians?: number[]; samples?:number[];
}
export interface Host {
	label: string; os: string; policy: Record<string,string>;
	configurations: Partial<Record<CfgId,{runtime:string;version:string;backend:string;source?:import('./benchmark-types').Source}>>;
	snapshots: Record<'s1'|'s2',Record<string,ViewCell>>;
}
export interface ViewData {
  featureVersions:Record<MachineId,{
    id:string;identity:string;channel:'stable'|'development';version:string;source:string;revision:string|null;collectedAt:string;
    description:{runtime:string;runtime_version:string;backend:string;source?:import('./benchmark-types').Source};
    features:{id:string;total:number;pass:number;failed:number;unsupported:number;compiledOnly:number;executed:number;reports:string[];reasons:string[];contracts:{workload:string;status:'passed'|'failed'|'unsupported';scope:string;report:string;reasons:string[]}[]}[];
  }[]>;
	threads:Record<MachineId,{created:string;configuration:string;node:string;v8:string;policy:string;evidence:string;sha256:string;results:{compilerMode:string;sharing:string;workers:number;operationsPerWorker:number;launches:{launch:number;samples:{elapsedNs:number;operations:number;verified:boolean}[]}[]}[]}>;
	applicationConfigurations:CfgId[]; schema: number; catalogue: Bench[]; hosts: Record<MachineId,Host>; reasons:string[];
	configurations:Record<CfgId,string>;
	statistics:{timingSamples:number|null;machines?:number};
	history:Record<MachineId,{
		catalogue?:Pick<Bench,'id'|'artifactSha256'|'group'|'abi'>[];referenceCells?:Record<string,ViewCell>;
		points:{date:string;revision:string;collectedAt?:string;status:string;currentLatency?:Partial<Record<CfgId,'s1'>>;releases?:Partial<Record<CfgId,{version:string;publishedAt:string;url:string}>>}[];
		workloads:string[];artifactSha256:Record<string,string>;versions:Record<CfgId,string[]>;sources?:Partial<Record<CfgId,(import('./benchmark-types').Source|undefined)[]>>;
		cells:Record<string,(ViewCell & {role:'retrospective-revision'|'fixed-comparison-baseline'})[]>;
	}>;
	reports: Record<string,{collectionBundle?:{id:string;machine:string;url:string};runId:string;created:string;evidence:string;sha256:string;options:Record<string,unknown>;memorySource?:{id:string;note:string};codeSource?:{id:string;note:string};codeRecords:{runtime:string;workload:string;trial:string;status:string;index:number;inspectable:boolean}[];configurations:string[];host:string}>;
}
