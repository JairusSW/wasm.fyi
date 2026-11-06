import type { MachineId } from './data/types';
import type { FeatureEntrant, FeatureSummary } from './feature-summary';
export type HomeMetric = 'steady' | 'compile' | 'inst' | 'rss' | 'e2e';
export const HOME_METRICS: Record<HomeMetric, {label: string; group: 'lat' | 'mem'}> = {
 steady:{label:'Execution',group:'lat'},compile:{label:'Compile',group:'lat'},inst:{label:'Instantiate',group:'lat'},rss:{label:'Memory',group:'mem'},e2e:{label:'End-to-end',group:'lat'}
};
export interface HomeMachine {
 host:string;updated:string|null;workloads:number;features:FeatureSummary|null;
 metrics:Record<HomeMetric,{total:number;rows:{c:FeatureEntrant;v:number;bar:number}[]}>;
}
export interface Homepage {schema:1;revision:string;samples:{all:number;latest:number};machines:Partial<Record<MachineId,HomeMachine>>}
