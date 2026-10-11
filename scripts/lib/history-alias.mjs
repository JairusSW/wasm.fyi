// A weekly alias shares measured samples; it never launches an adapter.
export function aliasCapture(capture,pin){
 if(pin.status!=='reused'||!pin.revision||capture.source?.revision!==pin.revision||capture.source?.repository!==pin.repository||capture.source?.asOf!==pin.reuseTargetWeek)return null;
 if(!capture.results?.length||capture.results.some(row=>!pin.configurations.includes(row.engine)))return null;
 return {...capture,source:{...capture.source,revision:pin.revision,repository:pin.repository,asOf:pin.targetWeek,kind:pin.tag?'release':'snapshot',ref:pin.tag||'main@'+pin.revision.slice(0,12),...(pin.dateBasis?{dateBasis:pin.dateBasis}:{dateBasis:undefined})}};
}
