// These embeddings compile Wasm to JVM/Truffle code but expose no public,
// artifact-attributed native image. Their honest code metric is explicit n/a.
const unavailableNativeImages=new Set([
 'chicory-jit|jvm-bytecode-compiler',
 'endive-jit|jvm-bytecode-compiler',
 'graalwasm|truffle-graal',
]);
export function qualifiedNativeCode(row) {
 const unavailable=/interpreter/i.test(row?.backend||'')||unavailableNativeImages.has([row?.engine,row?.backend].join('|'));
 return unavailable
  ?row?.codeStatus==='unsupported'&&row.codeBytes===null
  :row?.codeStatus==='ok'&&Number.isSafeInteger(row.codeBytes)&&row.codeBytes>0;
}
export function assertQualifiedCaptureRow(row,minimumSamples=5) {
 if(!row||row.latencyStatus!=='ok'||!Number.isSafeInteger(row.timingSamples)||row.timingSamples<minimumSamples||row.memoryStatus!=='ok'||!Number.isSafeInteger(row.peakRssBytes)||row.peakRssBytes<=0||!qualifiedNativeCode(row))throw Error('Capture metrics missing: '+JSON.stringify(row));
}
