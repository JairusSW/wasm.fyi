import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {site,command,digest} from './lib/wasmbench.mjs';
import {latestWasmtime,wastReport,suites,checkoutSuite,inventory,goConformance,hostIdentity,wasiReport,wasiCaseTotals} from './lib/conformance.mjs';
import {releaseSource,assertReleasedSource} from './lib/release-policy.mjs';
const action=process.argv[2] || 'plan';
const lanes=(process.env.WASMBENCH_CONFORMANCE_LANES || 'wasmtime-core,winch-core,wasmtime-component,wasmtime-wasi,wago-component').split(',');
if(action==='plan'){console.log(JSON.stringify({releasePolicy:'latest published non-nightly release; no main or dirty engine builds',suites,lanes,excludedFromPerformance:true},null,2));}
else if(action==='collect'){
  const directory=join(site,'.wasmbench/conformance',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(directory,{recursive:true});
  const report={schema:1,releaseAsOf:process.env.WASMBENCH_RELEASE_AS_OF || null,created:new Date().toISOString(),host:hostIdentity(),lanes:[],policy:'Official upstream conformance suites are distinct from representative performance corpora. Only published engine releases run. Failures, skips, unsupported runners and infrastructure errors stay explicit.'};
  report.coverage=Object.keys((await import('./lib/engine-sources.mjs')).engineSources).map(engine=>({engine,status:lanes.some(l=>l.startsWith(engine+'-'))?'selected':'uncollected',reason:lanes.some(l=>l.startsWith(engine+'-'))?undefined:'Qualified official-suite release runner not implemented.'}));
  let wasmtime;
  for(const lane of lanes){
    let result;
    try{
      if(['wasmtime-core','winch-core','wasmtime-component'].includes(lane)){
        wasmtime ||= await latestWasmtime(process.env.WASMBENCH_RELEASE_AS_OF);
        result=await wastReport(wasmtime,lane.endsWith('component')?'component':'core',{flags:lane==='winch-core'?['-C','compiler=winch']:[]});
      }else if(lane==='wasmtime-wasi'){
        wasmtime ||= await latestWasmtime(process.env.WASMBENCH_RELEASE_AS_OF);result=await wasiReport(wasmtime);
      }else if(['wago-wasi','wago-wasi-library','wago-component'].includes(lane)){
        const plugin=await releaseSource(lane.startsWith('wago-wasi')?'wago-org/wasi':'wago-org/component-model',{taggedLibrary:true,asOf:process.env.WASMBENCH_RELEASE_AS_OF});
        const engine=await releaseSource('wago-org/wago',{asOf:process.env.WASMBENCH_RELEASE_AS_OF});
        // Resolve tests against the released engine, never the plugin's pseudo-version dependency.
        const mod=join(directory,lane+'.mod');
        await writeFile(mod,await readFile(join(plugin.source,'go.mod')));
        const sum=join(plugin.source,'go.sum');
        const {exists}=await import('./lib/wasmbench.mjs');
        if(await exists(sum))await writeFile(mod.replace(/\.mod$/,'.sum'),await readFile(sum));
        command('go',['mod','edit','-modfile='+mod,'-replace=github.com/wago-org/wago='+engine.source],{cwd:plugin.source});
        let env={},component;
        if(lane.startsWith('wago-wasi')){
          component=await releaseSource('wago-org/component-model',{taggedLibrary:true,asOf:process.env.WASMBENCH_RELEASE_AS_OF});
          command('go',['mod','edit','-modfile='+mod,'-replace=github.com/wago-org/component-model='+component.source],{cwd:plugin.source});
        }
        if(lane==='wago-wasi' && process.platform!=='linux')throw Error('Released WASI plugin official-suite runner requires Linux; run this lane on Hub.');
        if(lane==='wago-wasi')env.WAGO_WASITEST_DIR=await checkoutSuite(suites.wasi);
        const tests=lane==='wago-wasi'?['-run','^TestWASISuite$','./p1']:lane==='wago-wasi-library'?['-run','^Test','./p1','./p2']:['-run','^(TestOfficialComponentModel.*Conformance|TestComponentModelConformanceCorpusIsComplete|TestWasmtimeWast.*Conformance)$','.'];
        for(const pin of [engine,...(component?[component]:[])])assertReleasedSource(pin.source,pin);
        result=await goConformance(plugin,['-modfile='+mod,...tests],env);
        for(const pin of [engine,...(component?[component]:[])])assertReleasedSource(pin.source,pin);
        result.plugin=plugin;result.engine=engine;if(component)result.dependencies=[component];
        if(lane==='wago-wasi'){
          result.goLeafTotals=result.totals;
          const totals=wasiCaseTotals(result.output);
          if(totals){result.totals=totals;result.unit='official Preview 1 cases';}
          else result.status='runner-error';
        }
        if(lane==='wago-wasi')result.suite={...suites.wasi,inventory:await inventory(join(env.WAGO_WASITEST_DIR,'tests'),'.wasm')};
        else if(lane==='wago-component'){
          const manifests=[];for(const path of ['testdata/conformance/manifest.json','testdata/conformance/wasmtime/manifest.json']){
            if(await exists(join(plugin.source,path))){const bytes=await readFile(join(plugin.source,path));const manifest=JSON.parse(bytes);manifests.push({path,sha256:digest(bytes),revision:manifest.revision,files:manifest.files.map(f=>({source:f.source,cases:f.cases.length,actions:f.cases.reduce((n,c)=>n+(c.actions?.length || 0),0)}))});}
          }
          result.suite={...suites.component,manifests};
          if(!manifests.length)result.status='runner-error';
        }else result.suite={repository:'wago-org/wasi',revision:plugin.revision,label:'Released WASI Preview 1 and Preview 2 plugin tests (not the upstream Linux-only suite)'};
      }else if(lane==='wago-core'){
        const engine=await releaseSource('wago-org/wago',{asOf:process.env.WASMBENCH_RELEASE_AS_OF}),suite=suites.core,source=await checkoutSuite(suite);
        result=await goConformance(engine,['-run','^TestSpecSuiteExec$','./src/wago'],{WAGO_SPECTEST_DIR:source,WAGO_SPEC_VERSION:'3.0',...(process.env.WAGO_SPEC_INTERPRETER?{WAGO_SPEC_INTERPRETER:process.env.WAGO_SPEC_INTERPRETER}:{})});
        result.suite={...suite,inventory:await inventory(join(source,suite.directory))};
        if(!/TOTAL\[3\.0\]/.test(result.output))result.status='runner-error';
      }else throw Error('Unknown or unqualified conformance lane: '+lane);
    }catch(error){result={status:'runner-error',reason:error.message};}
    report.lanes.push({id:lane,...result});
    await writeFile(join(directory,'report.json'),JSON.stringify(report)+'\n');
    console.log(lane,result.status || result.totals);
  }
  const bytes=await readFile(join(directory,'report.json'));await writeFile(join(directory,'sha256'),digest(bytes)+'\n');
  await writeFile(join(site,'.wasmbench/latest-conformance-report.txt'),directory+'\n');
  console.log('Conformance evidence: '+directory);
  if(report.lanes.some(l=>l.status==='runner-error'))process.exitCode=1;
}else throw Error('Usage: node scripts/conformance.mjs plan|collect');
