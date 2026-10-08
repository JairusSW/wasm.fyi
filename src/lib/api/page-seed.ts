import type {WireRecord,Overview} from './types';
import type {Availability,MatrixPage} from './site-data';
import type {MachineId,CfgId} from '../data/types';
export type PageSeed={schema:1;revision:string;machine:MachineId;environment:string;members:string[];baseline:CfgId;
 catalogs:{environments:WireRecord[];tracks:WireRecord[];workloads:WireRecord[]};availability:Availability;overviews:Record<string,Overview>;matrix?:MatrixPage;statistics?:{timingSamples:number|null;timingSamplePolicy:string}};
