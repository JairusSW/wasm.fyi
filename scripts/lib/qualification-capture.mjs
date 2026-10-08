export function assertQualifiedCaptureRow(row,minimumSamples=12) {
 const interpreter=/interpreter/i.test(row?.backend||'');
 const codeValid=interpreter
  ?row.codeStatus==='unsupported'&&row.codeBytes===null
  :row?.codeStatus==='ok'&&Number.isSafeInteger(row.codeBytes)&&row.codeBytes>0;
 if(!row||row.latencyStatus!=='ok'||!Number.isSafeInteger(row.timingSamples)||row.timingSamples<minimumSamples||row.memoryStatus!=='ok'||!Number.isSafeInteger(row.peakRssBytes)||row.peakRssBytes<=0||!codeValid)throw Error('Capture metrics missing: '+JSON.stringify(row));
}
