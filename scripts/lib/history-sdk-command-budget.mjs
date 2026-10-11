import{createSDKBuildBudget}from'./sdk-build-budget.mjs';
import{basename}from'node:path';
export function isHistoricalSDKBuildCommand(program,args){
 const name=basename(program);
 return(name==='git'&&args.some(a=>['init','fetch','clone','worktree','checkout','submodule'].includes(a)))||(name==='go'&&args[0]==='build')||args.some(a=>String(a).endsWith('weekly-build.mjs'));
}
// A pin owns one lazy deadline. Cached SDKs and metadata/guest commands do not
// start it; a weekly SDK subprocess inherits the same absolute deadline.
export function createHistoricalSDKCommandBudget(env){
 let budget,closed=false;
 return{get deadlineAt(){return budget?.deadlineAt},async run(program,args,operation){if(!isHistoricalSDKBuildCommand(program,args))return operation();if(closed)throw Error('SDK build command after source phase closed');if(!budget){budget=createSDKBuildBudget(env);env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS=String(budget.deadlineAt)}return budget.run(operation)},finish({check=false}={}){budget?.dispose();delete env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS;closed=true;if(check&&budget?.signal.aborted)throw budget.signal.reason}};
}
