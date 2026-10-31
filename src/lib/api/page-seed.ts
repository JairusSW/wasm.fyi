import type {WireRecord,Overview} from './types';
import type {Availability,MatrixPage} from './site-data';
import type {MachineId,CfgId} from '../data/types';
export type PageSeed={schema:1;revision:string;machine:MachineId;environment:string;members:string[];baseline:CfgId;
 catalogs:{environments:WireRecord[];tracks:WireRecord[];workloads:WireRecord[]};availability:Availability;overviews:Record<string,Overview>;matrix?:MatrixPage;statistics?:{timingSamples:number|null;timingSamplePolicy:string}};

// Only the current page's default machine and scalar results are embedded.
// Samples and arbitrary history ranges remain API reads.
export type BakedPageSeed={schema:2;revision:string;machine:MachineId;path:string;
 summary:{revision:string;platforms:import('./benchmark-types').PlatformChoice[]};
 view:import('./view-contract').ViewData;slots:[string,CfgId][];
 precomputed:Record<string,import('./compact-matrix').CompactAggregate>;
 loaded:[MachineId,string][];phases:[MachineId,string[]][];metadata:[MachineId,string][]};
