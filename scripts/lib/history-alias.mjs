// A weekly alias shares measured samples; it never launches an adapter.
export function aliasCapture(capture,pin){
 // Feature compatibility and performance are captured only for the latest source.
 if(capture.featureCompatibility===true)return null;
 if(pin.status!=='reused'||!pin.revision||capture.source?.revision!==pin.revision||capture.source?.repository!==pin.repository||capture.source?.asOf!==pin.reuseTargetWeek)return null;
 if(!capture.results?.length||capture.results.some(row=>!pin.configurations.includes(row.engine)||(typeof row.workload==='string'&&row.workload.startsWith('features/'))))return null;
 return {...capture,source:{...capture.source,revision:pin.revision,repository:pin.repository,asOf:pin.targetWeek,kind:pin.tag?'release':'snapshot',ref:pin.tag||'main@'+pin.revision.slice(0,12),...(pin.dateBasis?{dateBasis:pin.dateBasis}:{dateBasis:undefined})}};
}
