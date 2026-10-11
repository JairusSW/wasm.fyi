import {requireBuildCapacity,withBuildReserve} from './build-capacity.mjs';
import {isHistoricalSDKBuildCommand} from './history-sdk-command-budget.mjs';

// The caller holds the host lease. Cached metadata and guest execution bypass
// this source-build guard; every SDK command still checks the remaining reserve.
export function createHistoricalSDKCapacity({directory,engine,env},io={requireBuildCapacity,withBuildReserve}) {
 let checked=false;
 return {
  async run(program,args,operation) {
   if(!isHistoricalSDKBuildCommand(program,args))return operation();
   if(!checked){await io.requireBuildCapacity(directory,engine,env);checked=true;}
   return io.withBuildReserve(directory,engine,env,operation);
  },
 };
}
