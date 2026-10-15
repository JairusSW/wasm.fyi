const terminated='adapter terminated before response (see trial log)';
const fatal='zwasm: internal error — caught a fatal signal. This is a bug in zwasm (not a wasm trap); please report it.';
const engines=new Set(['zwasm-interpreter','zwasm-jit']);
// Preserve unknown disconnects as integration failures. A runtime's explicit
// fatal diagnostic in this exact trial is a recorded engine failure instead.
export async function identifyEngineFatals(trials,readLog){
 const known=[];
 for(const trial of trials){
  if(!engines.has(trial.runtime_configuration)||trial.status!=='error'||trial.reason!==terminated||!/^logs\/[\w.-]+\.log$/.test(trial.log||''))continue;
  const log=await readLog(trial.log);
  if(log.trim()===fatal)known.push(trial);
 }
 return trials.map(trial=>{
  const cause=known.find(failed=>failed.runtime_configuration===trial.runtime_configuration&&failed.workload===trial.workload&&(
   failed===trial||trial.reason===`adaptive phase ${failed.scenario}: ${terminated}`||failed.block<0&&trial.reason===`sacrificial check error: ${terminated}`));
  return cause?{...trial,reason:`Zwasm engine fatal signal during ${cause.scenario} (see ${cause.log})`,originalReason:trial.reason}:trial;
 });
}
