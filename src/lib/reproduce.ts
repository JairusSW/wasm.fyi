import aliases from '../../schemas/engine-cli.json';
import type {Source} from './api/benchmark-types';
export type ReproduceEngine={engine:string;version?:string;source?:Source};
const registry=aliases as Record<string,string>;
const reverse=Object.fromEntries(Object.entries(registry).map(([id,engine])=>[engine,id]));
/** Quote every shell token, including source refs and workload IDs from imported data. */
export function shellToken(value:string):string{return /^[A-Za-z0-9_./:@=,+-]+$/.test(value)?value:"'"+value.replaceAll("'","'\\''")+"'"}
export function reproductionCommand({engines,workloads,artifact,contract,pinned=false,compatibility=false}:{engines:ReproduceEngine[];workloads:string[];artifact?:string;contract?:string;pinned?:boolean;compatibility?:boolean}):{command:string;note:string}{
 if(!engines.length||!workloads.length)throw Error('Select an engine and workload first.');
 const selected:string[]=[],sources:string[]=[],digests:string[]=[];
 for(const item of engines){
  const id=registry[item.engine]?item.engine:reverse[item.engine];if(!id)throw Error('This configuration does not have a local CLI adapter yet.');
  const local=item.source?.ref.match(/^local:([a-f0-9]{40}):([a-f0-9]{64})$/);
  if(local){selected.push(id);sources.push(id+'=/path/to/'+registry[id]);digests.push(local[2]);continue}
  const revision=item.source?.revision.match(/^[a-f0-9]{40}$/i)?.[0];
  const tag=item.source?.kind==='release'&&/^v?[A-Za-z0-9][\w.-]*$/.test(item.source.ref)?item.source.ref:undefined;
  const version=/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(item.version||'')?item.version:undefined;
  if(pinned&&!revision&&!tag&&!version)throw Error('The exact runtime source was not recorded for this result.');
  selected.push(id+(revision||tag||version?'@'+(revision||tag||version):''));
 }
 if(new Set(digests).size>1)throw Error('Reproduce local source snapshots separately.');
 const args=['wasmfyi',compatibility?'test':'bench','--engines',[...new Set(selected)].join(','),'--corpora',[...new Set(workloads)].join(',')];
 if(artifact){if(workloads.length!==1||!/^[a-f0-9]{64}$/i.test(artifact))throw Error('An exact reproduction needs one recorded workload artifact.');args.push('--artifact',workloads[0]+'='+artifact)}
 if(contract){if(workloads.length!==1||!/^[a-f0-9]{64}$/i.test(contract))throw Error('The workload contract identity is invalid.');args.push('--contract',workloads[0]+'='+contract)}
 for(const source of sources)args.push('--source',source);
 if(digests[0])args.push('--source-digest',digests[0]);
 args.push('--rerun');
 return {command:args.map(shellToken).join(' '),note:sources.length?'Replace /path/to with the original source checkout. Its snapshot digest must match.':pinned?'Uses the recorded runtime source and validates the workload identity. Timings will depend on your machine.':'Runs the selected workload locally. Results are stored only on your machine.'};
}
