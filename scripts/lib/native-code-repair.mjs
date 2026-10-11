import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const files=value=>value&&Object.keys(value).length>0&&Object.entries(value).every(([path,digest])=>path.startsWith('/')&&sha(digest));
const codeFields=['codeStatus','codeBytes','codeKind'];

// Locate literal values without reserializing any unrelated bytes, including
// the original ordered samples, numeric spellings, whitespace and RSS fields.
function valueSpans(text){
 const spans=new Map();let cursor=0;
 const white=()=>{while(/\s/.test(text[cursor]||'')&&cursor<text.length)cursor++;};
 const string=()=>{const start=cursor++;while(cursor<text.length){const ch=text[cursor++];if(ch==='\\')cursor++;else if(ch==='"')return JSON.parse(text.slice(start,cursor));}throw Error('Unterminated JSON string');};
 function value(path){white();const start=cursor,ch=text[cursor];
  if(ch==='{'){cursor++;white();const keys=new Set();if(text[cursor]!=='}')for(;;){white();if(text[cursor]!=='"')throw Error('Invalid JSON key');const key=string();if(keys.has(key))throw Error('Duplicate JSON key');keys.add(key);white();if(text[cursor++]!==':')throw Error('Invalid JSON member');value([...path,key]);white();if(text[cursor]!==',')break;cursor++;}if(text[cursor++]!=='}')throw Error('Invalid JSON object');}
  else if(ch==='['){cursor++;white();let index=0;if(text[cursor]!==']')for(;;){value([...path,index++]);white();if(text[cursor]!==',')break;cursor++;}if(text[cursor++]!==']')throw Error('Invalid JSON array');}
  else if(ch==='"')string();
  else{while(cursor<text.length&&!/[\s,\]}]/.test(text[cursor]))cursor++;if(cursor===start)throw Error('Invalid JSON value');JSON.parse(text.slice(start,cursor));}
  spans.set(JSON.stringify(path),{start,end:cursor});
 }
 value([]);white();if(cursor!==text.length)throw Error('Trailing JSON bytes');return spans;
}

export function repairNativeCodeOnly(originalBytes,qualification,originalBinding){
 const original=Buffer.isBuffer(originalBytes)?originalBytes:Buffer.from(originalBytes),decoded=original.toString('utf8');
 if(!original.equals(Buffer.from(decoded,'utf8')))throw Error('Original capture contains invalid UTF8 bytes');
 const capture=JSON.parse(decoded);
 if(qualification?.status!=='passed'||qualification.databasePublished!==false||qualification.resourceOnly!==true)throw Error('Native-code qualification gate absent');
 const provenance=originalBinding?.planProvenance;
 const archivedPlans=provenance?.kind==='archived-startup-and-job-plan'&&provenance.perCaptureManifestRetained===false&&provenance.validated===true&&['startupPlanSha256','jobPlanSha256','startupReceiptSha256','buildReceiptSha256'].every(key=>sha(provenance[key]))&&typeof provenance.jobControllerPath==='string'&&provenance.jobControllerPath.startsWith('/')&&Array.isArray(provenance.qualifiedCommand)&&provenance.qualifiedCommand.length>0&&typeof provenance.qualifiedCommand[0]==='string'&&provenance.qualifiedCommand[0].startsWith('/')&&provenance.qualifiedCommand.every(arg=>typeof arg==='string');
 if(originalBinding?.captureSha256!==hash(original)||!sha(originalBinding.controllerSha256)||!files(originalBinding.runtimeFiles)||!(sha(originalBinding.manifestSha256)&&!provenance||archivedPlans))throw Error('Original capture/producer binding is not pinned');
 if(archivedPlans){
  if(originalBinding.manifestSha256!==undefined)throw Error('Archived plans cannot claim a per-capture manifest hash');
  const identity=provenance.identity;
  if(!identity||!equal(identity.source,capture.source)||!equal(identity.platform,capture.platform)||identity.controllerSha256!==originalBinding.controllerSha256||!equal(identity.runtimeFiles,originalBinding.runtimeFiles)||capture.results.some(row=>['engine','version','backend','workload','artifactSha256','contractSha256'].some(key=>row[key]!==identity[key])))throw Error('Archived plans do not match original capture identity');
 }

 if(!equal(qualification.originalBinding,originalBinding)||qualification.controllerSha256!==originalBinding.controllerSha256||!files(qualification.runtimeFiles))throw Error('Native-code original/controller/runtime binding changed');
 const compatible=qualification.compatibility;
 if(compatible?.status!=='passed'||!sha(compatible.originalTimingSectionSha256)||compatible.originalTimingSectionSha256!==compatible.currentTimingSectionSha256||!files(compatible.originalSdkFiles)||!equal(compatible.originalSdkFiles,compatible.currentSdkFiles))throw Error('Code-only binding compatibility is not qualified');
 const oldDigests=new Set(Object.values(originalBinding.runtimeFiles)),newDigests=new Set(Object.values(qualification.runtimeFiles));
 if(Object.values(compatible.originalSdkFiles).some(digest=>!oldDigests.has(digest)||!newDigests.has(digest)))throw Error('Immutable SDK files are absent from the recorded runtime bindings');
 if(!equal(capture.source,qualification.source)||!equal(capture.platform,qualification.platform))throw Error('Native-code source/platform identity changed');
 const observation=qualification.observation;
 if(!['native.code_size','native.code_image'].includes(observation?.metric)||observation.status!=='available'||observation.profile!=='code'||observation.phase!=='compile'||observation.scope!=='compiled_module'||observation.denominator!=='module'||observation.unit!=='bytes'||observation.quality!=='engine_reported'||!observation.collector||!observation.collector_version||!Number.isSafeInteger(observation.value)||observation.value<=0)throw Error('Unqualified per-module native-code observation');
 const rows=capture.results;if(rows?.length!==4||new Set(rows.map(row=>row.phase)).size!==4||rows.some(row=>!['compile','instantiate','first-call','steady'].includes(row.phase)))throw Error('Original four-phase capture differs');
 const replacements=[],changedPhases=[],text=original.toString('utf8'),spans=valueSpans(text),kind=observation.metric==='native.code_image'?'native-image':'engine-reported';
 for(const [index,row] of rows.entries()){
  if(row.engine!==qualification.engine||row.workload!==qualification.workload||row.artifactSha256!==qualification.artifactSha256||row.contractSha256!==qualification.contractSha256||row.version!==qualification.version||row.backend!==qualification.backend)throw Error('Native-code workload/runtime identity changed');
  if(!['ok','failed','unsupported'].includes(row.latencyStatus))throw Error('Original latency disposition invalid');
  if(row.latencyStatus!=='ok')continue;
  if(row.codeStatus==='ok'){if(row.codeBytes!==observation.value||row.codeKind!==kind)throw Error('Existing qualified native code conflicts');continue;}
  const next={codeStatus:'ok',codeBytes:observation.value,codeKind:kind};
  for(const field of codeFields){const span=spans.get(JSON.stringify(['results',index,field]));if(!span)throw Error('Original required code field absent');replacements.push({...span,value:JSON.stringify(next[field])});}
  changedPhases.push(row.phase);
 }
 let repaired=text;for(const replacement of replacements.sort((a,b)=>b.start-a.start))repaired=repaired.slice(0,replacement.start)+replacement.value+repaired.slice(replacement.end);
 const after=JSON.parse(repaired),withoutCode=value=>({...value,results:value.results.map(row=>{const result={...row};for(const field of codeFields)delete result[field];return result;})});
 if(!equal(withoutCode(capture),withoutCode(after)))throw Error('Native-code repair changed an unrelated field');
 return {bytes:Buffer.from(repaired),receipt:{status:'passed',originalSha256:hash(original),derivedSha256:hash(Buffer.from(repaired)),changedPhases,changedFields:codeFields,originalBinding,qualificationSemanticSha256:hash(Buffer.from(JSON.stringify(qualification))),qualificationSemanticEncoding:'JSON.stringify property-order UTF8',latencySamplesRssUnchanged:true}};
}
