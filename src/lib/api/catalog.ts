import type {Bench,CfgId,MachineId} from '../data/types';
import type {WireRecord} from './types';
import type {ViewData} from './view-contract';

export const legacySlots:Partial<Record<CfgId,string>>={A:'wasmtime',D:'wasmer-singlepass',E:'wazero',F:'v8',G:'wago',L:'wavm',T:'wasm2c-gcc',U:'w2c2-gcc'};
export type HostScope={anchor:string;environments:string[];label:string;os:string;policy:Record<string,string>;record:WireRecord};
export function hostScopes(records:WireRecord[]):Partial<Record<MachineId,HostScope>>{
 const groups=new Map<string,WireRecord[]>();
 for(const record of records){const d=record.data;const key=JSON.stringify([d.os,d.arch,d.hostname,d.cpu_description]);const items=groups.get(key)||[];items.push(record);groups.set(key,items)}
 const scopes:Partial<Record<MachineId,HostScope>>={};
 for(const entries of groups.values()){
  entries.sort((a,b)=>a.id.localeCompare(b.id));const record=entries[0],d=record.data;
  const machine=d.os==='linux'?'m1':d.os==='darwin'?'m2':!scopes.m1?'m1':'m2';
  if(scopes[machine])throw Error('More than one physical host occupies a legacy machine slot; choose an explicit host scope');
  const complete=[d.os,d.arch,d.hostname,d.cpu_description].every(v=>typeof v==='string'&&v.length>0);
  scopes[machine]={anchor:record.id,environments:complete?entries.map(r=>r.id):[],label:[d.cpu_description,d.hostname].filter(Boolean).join(' · ')||`Recorded environment ${record.id.slice(0,12)}`,os:[`${d.os||'unknown'}/${d.arch||'unknown'}`,d.kernel].filter(Boolean).join(' · '),policy:(d.policy||{}) as Record<string,string>,record};
 }
 return scopes;
}
export function workloadBench(record:WireRecord,group?:string):Bench{
 const d=record.data;const provenance=d.provenance as Record<string,unknown>|undefined;
 const original=d.original_contract as Record<string,unknown>|undefined;
 const id=String(d.id);const tags=[...new Set([...(Array.isArray(d.features)?d.features:[]),...(Array.isArray(original?.tags)?original.tags:[])])].map(String);
 return {id,artifactSha256:String(d.sha256||''),tags,kb:typeof d.bytes==='number'?d.bytes/1024:null,ms:null,group:group||String(provenance?.category||(/^(mechanisms\/)(wasm-to-host-call|host-to-wasm-call)$/.test(id)?'Host calls':id.startsWith('features/')?`Features · ${provenance?.feature||tags[0]||'baseline'}`:'Other workloads')),
  purpose:typeof original?.desc==='string'?original.desc:typeof provenance?.description==='string'?provenance.description:typeof provenance?.purpose==='string'?provenance.purpose:undefined,src:typeof d.source==='string'?d.source:undefined,input:JSON.stringify(d.args||[]),abi:String(d.abi||''),reset:String(d.reset||''),oracle:d.oracle,unitsPerInvocation:typeof d.units_per_invocation==='number'?d.units_per_invocation:undefined,workUnit:String(d.work_unit||''),baseline:provenance?.baseline===true,evidenceScope:typeof provenance?.scope==='string'?provenance.scope:typeof d.evidence_scope==='string'?d.evidence_scope:'unknown'};
}
export function configurationFacts(record:WireRecord,track?:WireRecord){
 const d=record.data,description=(d.description||{}) as Record<string,unknown>;
 return {runtime:String(d.id||track?.data.sourceRuntimeId||description.runtime||''),version:String(d.version||description.runtime_version||'not recorded'),backend:String(d.backend||description.backend||track?.data.backend||'not recorded')};
}
export function referencedReport(id:string,created:string):ViewData['reports'][string]{
 return {runId:id,created,evidence:`/api/v1/reports/${id}`,sha256:'',options:{},codeRecords:[],configurations:[],host:''};
}
