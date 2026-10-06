import assert from 'node:assert/strict';
import {digest} from './wasmbench.mjs';
import {countOutcomes,wasiCaseTotals} from './conformance.mjs';
const HASH=/^[a-f0-9]{64}$/;
const OUTCOMES=['passed','failed','unsupported','skipped','runner-error','crashed'];
const COUNT_KEYS=new Set([...OUTCOMES,'xfailed','xpassed']);
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
function counts(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Missing conformance counts');
  for(const [key,n]of Object.entries(value))assert(COUNT_KEYS.has(key)&&Number.isSafeInteger(n)&&n>=0,'Invalid conformance outcome count');
}
function sameCounts(actual,expected){counts(actual);for(const key of new Set([...Object.keys(actual),...Object.keys(expected)]))assert.equal(actual[key]??0,expected[key]??0,'Conformance totals differ from recorded outcomes');}
function sourcePath(path){return typeof path==='string'&&path.length>0&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(part=>!part||part==='.'||part==='..');}

// This proves archive integrity and structural consistency, not independent
// suite execution or a qualification of the producer/operator.
export function verifyConformanceArchive(bytes,receipt){
  const sha256=digest(bytes);assert.equal(receipt.toString().trim(),sha256,'Changed conformance archive');
  const report=JSON.parse(bytes);assert.equal(report.schema,1);
  assert(report.host&&['hostname','os','arch'].every(key=>typeof report.host[key]==='string'&&report.host[key].length>0),'Missing conformance environment');
  assert(typeof report.created==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(report.created)&&Number.isFinite(Date.parse(report.created)),'Missing conformance collection time');
  assert(new Date(report.created.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===report.created.slice(0,10),'Invalid conformance calendar day');
  assert(Array.isArray(report.lanes)&&report.lanes.length>0&&report.lanes.length<=128,'Invalid conformance lanes');
  const lanes=new Set();
  for(const lane of report.lanes){
    assert(ID.test(lane.id)&&!lanes.has(lane.id),'Duplicate or invalid conformance lane');lanes.add(lane.id);
    if(lane.status!==undefined)assert(OUTCOMES.includes(lane.status),'Unknown conformance lane outcome');
    if(lane.totals!==undefined)counts(lane.totals);
    if(lane.kind==='wast'){
      assert(lane.unit==='files'&&lane.suite&&Array.isArray(lane.suite.inventory)&&lane.suite.inventory.length>0&&Array.isArray(lane.results),'Missing WAST file evidence');
      assert.equal(lane.results.length,lane.suite.inventory.length,'Missing WAST outcome');
      const files=new Map();for(const file of lane.suite.inventory){assert(sourcePath(file.path)&&HASH.test(file.sha256)&&!files.has(file.path),'Invalid WAST inventory');files.set(file.path,file.sha256)}
      const seen=new Set();for(const result of lane.results){assert(files.has(result.path)&&!seen.has(result.path),'Duplicate or foreign WAST outcome');seen.add(result.path);assert.equal(result.sha256,files.get(result.path),'Changed WAST input');assert(OUTCOMES.includes(result.status),'Unknown WAST outcome')}
      assert(/^v[0-9]/.test(lane.engine?.tag)&&HASH.test(lane.engine?.sha256),'Missing release-pinned WAST engine');
      sameCounts(lane.totals,countOutcomes(lane.results));
    } else if(lane.kind==='go-native-suite'&&lane.unit==='official Preview 1 cases'){
      const expected=wasiCaseTotals(lane.output||'');assert(expected,'Missing official Preview 1 case totals');sameCounts(lane.totals,expected);
    } else if(lane.kind==='go-native-suite'&&lane.unit==='leaf subtests'){
      assert(Array.isArray(lane.results),'Missing Go leaf outcomes');
      assert(lane.status!=='passed'||lane.results.length>0,'Successful Go lane has no recorded leaf outcomes');
      const seen=new Set();for(const result of lane.results){assert(typeof result.name==='string'&&result.name&&OUTCOMES.includes(result.status),'Invalid Go leaf outcome');const key=JSON.stringify([result.package??null,result.name]);assert(!seen.has(key),'Duplicate Go leaf outcome');seen.add(key)}
      sameCounts(lane.totals,countOutcomes(lane.results));
    } else if(lane.kind==='official-wasi-runner'){
      assert(lane.unit==='cases'&&Array.isArray(lane.results),'Missing official WASI cases');
      assert(lane.results.every(row=>OUTCOMES.includes(row.status)),'Unknown official WASI case outcome');sameCounts(lane.totals,countOutcomes(lane.results));
    } else {
      assert(lane.kind===undefined&&lane.status==='runner-error'&&typeof lane.reason==='string'&&lane.reason,'Unqualified conformance lane kind');
    }
  }
  if(report.coverage!==undefined){assert(Array.isArray(report.coverage),'Invalid conformance coverage');const engines=new Set();for(const row of report.coverage){assert(ID.test(row.engine)&&!engines.has(row.engine)&&['selected','uncollected'].includes(row.status),'Invalid conformance coverage state');engines.add(row.engine)}}
  return {report,sha256,receiptSha256:digest(receipt)};
}

export function conformanceSummary(report,sha256){
  assert(HASH.test(sha256),'Invalid conformance source identity');
  return {file:sha256+'.json',sha256,created:report.created,host:report.host,lanes:report.lanes.map(l=>({id:l.id,unit:l.unit,status:l.status||(Object.entries(l.totals).some(([key,n])=>['failed','crashed','runner-error'].includes(key)&&n>0)?'failed':'passed'),totals:l.totals||(l.upstream&&Object.fromEntries(['passed','failed','skipped','xfailed','xpassed'].map(key=>[key,l.upstream.results.reduce((n,g)=>n+(g[key]||0),0)]))),engine:l.engine,suite:l.suite&&{repository:l.suite.repository,revision:l.suite.revision,label:l.suite.label},reason:l.reason,...(l.parserVersion?{parserVersion:l.parserVersion}:{})}))};
}
