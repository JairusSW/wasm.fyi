#!/usr/bin/env node
// Untimed, source-pinned positive WAST checks. Never counted as performance.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const base=path.join(root,'corpora/features/upstream');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2);
const option=(name,fallback)=>args.find(a=>a.startsWith(name+'='))?.slice(name.length+1)??fallback;
const emit=x=>process.stdout.write(JSON.stringify(x,null,2)+'\n');
const errorText=e=>String(e?.stack??e);
const serial=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString()+'n':v);

function runWorker(jsonPath,tool) {
  const fixture=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
  let instance;
  const refs=new Map();
  const extern=value=>{if(!refs.has(value))refs.set(value,Object.freeze({wastExternref:value}));return refs.get(value);};
  const unsupported=v=>v.type==='v128'||v.type==='i31ref'||(!['i32','i64','f32','f64','externref','funcref'].includes(v.type))||(v.type==='funcref'&&v.value!=='null');
  function decode(v) {
    if(v.type==='i32')return Number(BigInt.asIntN(32,BigInt(v.value)));
    if(v.type==='i64')return BigInt.asIntN(64,BigInt(v.value));
    if(v.type==='externref')return v.value==='null'?null:extern(v.value);
    if(v.type==='funcref'&&v.value==='null')return null;
    if(v.type==='f32'||v.type==='f64') {
      if(v.value?.startsWith('nan:'))return NaN;
      const b=new ArrayBuffer(8),d=new DataView(b);
      if(v.type==='f32'){d.setUint32(0,Number(BigInt(v.value)),true);return d.getFloat32(0,true);}
      d.setBigUint64(0,BigInt(v.value),true);return d.getFloat64(0,true);
    }
    throw new Error('Unsupported WAST value '+serial(v));
  }
  function matches(actual,expected) {
    if(expected.value?.startsWith('nan:'))return Number.isNaN(actual);
    return Object.is(actual,decode(expected));
  }
  function invoke(a) {
    if(a.module)throw new Error('Named-module actions are not supported by this selection runner');
    if(a.type==='get')return instance.exports[a.field].value;
    if(a.type!=='invoke')throw new Error('Unexpected action '+a.type);
    const fn=instance.exports[a.field];
    if(typeof fn!=='function')throw new Error('Missing export '+a.field);
    return fn(...a.args.map(decode));
  }
  function wasmSideAssertion(c) {
    if(c.action.type!=='invoke'||c.expected.length!==1)return null;
    const expected=c.expected[0];
    const choices=expected.type==='either'?expected.values:[expected];
    const vector=choices.every(v=>v.type==='v128');
    const i31=expected.type==='i31ref';
    if(!vector&&!i31)return null;
    const lanes={i8:'i8x16',i16:'i16x8',i32:'i32x4',i64:'i64x2'};
    function watValue(v) {
      if(v.type==='v128'&&lanes[v.lane_type]&&Array.isArray(v.value))
        return '(v128.const '+lanes[v.lane_type]+' '+v.value.map(x=>BigInt(x).toString()).join(' ')+')';
      if(v.type==='i32'||v.type==='i64')return '('+v.type+'.const '+BigInt(v.value).toString()+')';
      throw new Error('Unsupported Wasm-side literal '+serial(v));
    }
    const call='(call $subject '+c.action.args.map(watValue).join(' ')+')';
    const checks=vector?choices.map(v=>'(i8x16.all_true (i8x16.eq (local.get $actual) '+watValue(v)+'))'):[];
    const comparison=checks.reduce((a,b)=>a?'(i32.or '+a+' '+b+')':b,'');
    const resultType=vector?'v128':'(ref i31)';
    const body=vector?'(local $actual v128) (local.set $actual '+call+') '+comparison:'(drop (i31.get_s '+call+')) (i32.const 1)';
    const wat='(module (import "subject" "target" (func $subject '+c.action.args.map(v=>'(param '+v.type+')').join(' ')+' (result '+resultType+'))) (func (export "check") (result i32) '+body+'))';
    const watPath=path.join(path.dirname(jsonPath),'assertion-'+c.line+'.wat'),wasmPath=watPath+'.wasm';
    fs.writeFileSync(watPath,wat);
    const parsed=spawnSync(tool,['parse',watPath,'-o',wasmPath],{encoding:'utf8',timeout:10000});
    if(parsed.status!==0||parsed.error)throw new Error('Wasm-side assertion wrapper failed: '+String(parsed.error??parsed.stderr));
    const bytes=fs.readFileSync(wasmPath);
    const wrapper=new WebAssembly.Instance(new WebAssembly.Module(bytes),{subject:{target:instance.exports[c.action.field]}});
    if(wrapper.exports.check()!==1)throw new Error('Wasm-side exact upstream oracle mismatch');
    return {adapter:'wasm-to-wasm-assertion-wrapper',wrapperSource:wat,wrapperSourceSha256:sha(wat),wrapperSha256:sha(bytes)};
  }
  const results=[],setupResults=[];
  let moduleUnavailable=null,blocked=null,setupCount=0;
  for(const c of fixture.commands) {
    if(c.type==='module') {
      const bytes=fs.readFileSync(path.join(path.dirname(jsonPath),c.filename));
      let module;
      try {module=new WebAssembly.Module(bytes);}
      catch(e) {
        if(e instanceof WebAssembly.CompileError){moduleUnavailable=errorText(e);continue;}
        throw e;
      }
      try {instance=new WebAssembly.Instance(module,{spectest:{print_i32_f32:()=>{}}});}
      catch(e){blocked='Instantiation failed: '+errorText(e);}
      continue;
    }
    if(!['action','assert_return'].includes(c.type))throw new Error('Disallowed WAST command '+c.type);
    const detail={line:c.line,export:c.action.field};
    if(c.type==='action') {
      if(moduleUnavailable||blocked)continue;
      if(c.action.args.some(unsupported))throw new Error('Unsupported setup action; cannot preserve state');
      try{invoke(c.action);setupCount++;setupResults.push({...detail,status:'passed'});}catch(e){blocked='Setup action failed: '+errorText(e);setupResults.push({...detail,status:'failed',reason:blocked});}
      continue;
    }
    if(moduleUnavailable){results.push({...detail,status:'unsupported',reason:moduleUnavailable});continue;}
    if(blocked){results.push({...detail,status:'failed',reason:blocked});continue;}
    if(c.action.args.some(unsupported)||c.expected.some(unsupported)) {
      try{
        const wrapped=wasmSideAssertion(c);
        if(wrapped)results.push({...detail,status:'passed',...wrapped});
        else results.push({...detail,status:'skipped-adapter',reason:'WAST value lacks a scalar or Wasm-side assertion adapter'});
      }catch(e){results.push({...detail,status:'failed',reason:errorText(e)});}
      continue;
    }
    try{
      const actual=invoke(c.action);
      const actualList=c.expected.length===0?(actual===undefined?[]:[actual]):c.expected.length===1?[actual]:actual;
      if(!Array.isArray(actualList)||actualList.length!==c.expected.length||!c.expected.every((v,i)=>matches(actualList[i],v)))
        throw new Error('Oracle mismatch: expected '+serial(c.expected)+'; received '+serial(actualList));
      results.push({...detail,status:'passed'});
    } catch(e){results.push({...detail,status:'failed',reason:errorText(e)});}
  }
  return {setupCount,setupResults,results};
}

if(args[0]==='--worker') {
  try{emit(runWorker(args[1],args[2]));}catch(e){emit({error:errorText(e)});process.exitCode=1;}
} else {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wasm-fyi-positive-'));
  const report={schema:1,kind:'curated-positive-semantic-check',scope:'Selected ordinary positive assertions; not full official conformance and not performance evidence',collectedAt:new Date().toISOString(),runtime:{node:process.version,v8:process.versions.v8,execArgv:process.execArgv,platform:process.platform,arch:process.arch,executableSha256:sha(fs.readFileSync(process.execPath))},sources:[]};
  try{
    const tool=option('--wasm-tools',process.env.WASMBENCH_WASM_TOOLS??'wasm-tools');
    const toolVersion=spawnSync(tool,['--version'],{encoding:'utf8',timeout:10000});
    if(toolVersion.status!==0||toolVersion.error)throw new Error('Cannot run wasm-tools: '+(toolVersion.error??toolVersion.stderr));
    report.tool=toolVersion.stdout.trim();
    const toolPath=fs.existsSync(tool)?tool:(process.env.PATH??'').split(path.delimiter).map(p=>path.join(p,tool)).find(p=>fs.existsSync(p));
    if(!toolPath)throw new Error('Cannot locate wasm-tools executable for hashing');
    report.toolSha256=sha(fs.readFileSync(toolPath));
    if(!/^wasm-tools 1\.260\.0(?: \([^\n]+\))?$/.test(report.tool))throw new Error('Expected pinned wasm-tools 1.260.0, got '+report.tool);
    const indexBytes=fs.readFileSync(path.join(base,'index.json'));
    report.indexSha256=sha(indexBytes);
    const index=JSON.parse(indexBytes);
    for(const source of index.sources.filter(s=>s.kind==='selected-positive-wast')) {
      if(source.repository!=='https://github.com/WebAssembly/spec'||source.revision!=='970c4116e644e2bf7acb39aab8b733db14ccdf28'||!/^[a-f0-9]{64}$/.test(source.upstreamSha256))throw new Error('Unexpected upstream pin for '+source.id);
      const input=path.resolve(base,source.localPath);
      if(!input.startsWith(base+path.sep))throw new Error('Fixture path escapes curated directory');
      const bytes=fs.readFileSync(input);
      if(sha(bytes)!==source.localSha256)throw new Error('Local digest mismatch for '+source.id);
      if(/\(assert_(trap|invalid|malformed|exhaustion)\b/.test(bytes.toString()))throw new Error('Non-positive assertion in '+source.id);
      const dir=path.join(temp,source.id);fs.mkdirSync(dir);
      const json=path.join(dir,'commands.json');
      const parse=spawnSync(tool,['json-from-wast',input,'--wasm-dir',dir,'-o',json],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
      if(parse.status!==0||parse.error)throw new Error('WAST conversion failed for '+source.id+': '+(parse.error??parse.stderr));
      const commands=JSON.parse(fs.readFileSync(json,'utf8')).commands;
      if(commands.filter(c=>c.type==='assert_return').length!==source.assertions)throw new Error('Assertion inventory mismatch for '+source.id);
      for(const c of commands.filter(c=>c.type==='module')) {
        if(path.basename(c.filename)!==c.filename)throw new Error('Unexpected generated module path');
        const valid=spawnSync(tool,['validate',path.join(dir,c.filename),'--features','all'],{encoding:'utf8',timeout:30000});
        if(valid.status!==0||valid.error)throw new Error('Invalid selected module '+source.id+': '+(valid.error??valid.stderr));
      }
      const child=spawnSync(process.execPath,[...process.execArgv,fileURLToPath(import.meta.url),'--worker',json,path.resolve(toolPath)],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
      let outcome;
      if(child.status!==0||child.error)outcome={results:Array.from({length:source.assertions},()=>({status:'failed',reason:'Fixture runner failed: '+String(child.error??child.stderr??child.stdout)}))};
      else{outcome=JSON.parse(child.stdout);if(outcome.error)throw new Error(outcome.error);}
      const modules=commands.filter(c=>c.type==='module').map(c=>({filename:c.filename,sha256:sha(fs.readFileSync(path.join(dir,c.filename)))}));
      report.sources.push({id:source.id,upstreamUrl:source.upstreamUrl,revision:source.revision,upstreamSha256:source.upstreamSha256,localSha256:source.localSha256,modules,...outcome});
    }
    report.counts={total:0,passed:0,failed:0,unsupported:0,'skipped-adapter':0,setupPassed:0,setupFailed:0};
    for(const s of report.sources)for(const r of s.results){report.counts.total++;report.counts[r.status]++;}
    for(const s of report.sources)for(const r of s.setupResults??[])report.counts[r.status==='passed'?'setupPassed':'setupFailed']++;
    if(report.counts.total===0)throw new Error('Zero assertions is not success');
    report.status=report.counts.failed+report.counts.setupFailed?'failed':report.counts.unsupported+report.counts['skipped-adapter']?'partial':'passed';
    if(report.counts.failed+report.counts.setupFailed||(args.includes('--require-all')&&report.status!=='passed'))process.exitCode=1;
  }catch(e){report.status='runner-error';report.error=errorText(e);process.exitCode=1;}
  finally{fs.rmSync(temp,{recursive:true,force:true});}
  const out=option('--out',path.join(root,'.wasmbench/feature-upstream-spec.json'));
  if(out){const dest=path.resolve(out);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');}
  emit(report);
}
