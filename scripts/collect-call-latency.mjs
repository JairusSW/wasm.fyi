import {mkdir,readFile,writeFile,rm,copyFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {harness,site} from './lib/wasmbench.mjs';
import {exportWasmFyiReport} from './lib/wasmfyi-export.mjs';
import {parseCorpusJSON} from './lib/corpus.mjs';
const label=process.argv[2];if(!/^[a-z0-9-]+$/.test(label||''))throw Error('Provide a safe collection label');
const {run}=await harness();
const directory=join(site,'.wasmbench/experiments',label+'-calls-'+Date.now());await mkdir(directory,{recursive:true});
const manifest=join(directory,'calls.json');run('corpus','--suite','calls','--out',manifest);
const reports=[];
for(const [i,w] of parseCorpusJSON(await readFile(manifest,'utf8')).entries()) {
 const scratch=join(directory,'call-'+i);await mkdir(scratch);const suite=join(scratch,'suite.json');await writeFile(suite,JSON.stringify([w])+'\n');
 const timing=join(scratch,label+'-calls-'+i+'-'+Date.now());
 process.stdout.write(run('run','--archive-tools=true','--suite',suite,'--runtimes','wago','--scenarios','steady','--profile','timing','--launches','1','--samples','5','--operations','1000000','--warmup','3','--workers','1','--timeout','5m','--validation-profile','all','--out',timing));
 run('verify','--run',timing);
 const report=join(scratch,'report');run('report','--run',timing,'--out',report);run('verify-report','--dir',report);
 const data=JSON.parse(await readFile(join(report,'data.json')));
 if(!data.bundle.manifest.lock.runtime_configurations[0].description.runtime_version.startsWith(process.env.WASMBENCH_WAGO_REVISION+'/'))throw Error('Call adapter does not match pinned Wago revision');
 const exported=await exportWasmFyiReport(report,join(directory,'exports'));reports.push(resolve(directory,'exports',exported.path));
 const logs=join(directory,'logs','call-'+i);await mkdir(join(logs,'trials'),{recursive:true});
 for(const file of ['manifest.json','checksums.json'])await copyFile(join(timing,file),join(logs,file));
 for(const file of await readdir(join(timing,'trials')))await copyFile(join(timing,'trials',file),join(logs,'trials',file));
 await rm(scratch,{recursive:true,force:true});
}
await writeFile(join(site,'.wasmbench',label+'-calls-reports.json'),JSON.stringify(reports)+'\n');
