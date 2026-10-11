// One deadline for an entire source SDK attempt, shared by every command.
export function createSDKBuildBudget(env=process.env,now=Date.now()){
 const timeoutMs=Number(env.WASMFYI_SDK_BUILD_TIMEOUT_MS??90*60*1000);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0||timeoutMs>2147483647)throw Error('Invalid SDK total build timeout');
 const deadlineAt=env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS===undefined?now+timeoutMs:Number(env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS);
 if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=0)throw Error('Invalid SDK build deadline');
 if(deadlineAt>now+timeoutMs)throw Error('SDK deadline exceeds total allowed budget');
 const controller=new AbortController(),failure=Object.assign(Error(`SDK build exceeded total ${timeoutMs} ms budget; preserve source/artifacts and repair integration`),{code:'WASMFYI_SDK_BUILD_TIMEOUT'});
 let timer;if(deadlineAt<=now)controller.abort(failure);else{timer=setTimeout(()=>controller.abort(failure),Math.min(deadlineAt-now,2147483647));timer.unref()}
 return {signal:controller.signal,deadlineAt,timeoutMs,dispose:()=>clearTimeout(timer),async run(operation,otherSignal){if(controller.signal.aborted)throw failure;const signal=otherSignal?AbortSignal.any([controller.signal,otherSignal]):controller.signal;try{const value=await operation(signal);if(controller.signal.aborted)throw failure;return value}catch(error){throw controller.signal.aborted?failure:error}}};
}
