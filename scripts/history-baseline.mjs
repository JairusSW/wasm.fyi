import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config, installDirectory, locked, site } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
import { stageHistoryBaseline } from './lib/history-baseline.mjs';
await locked(async()=>{
  await mkdir(join(site,'.wasmbench'),{recursive:true});
  const temporary=await mkdtemp(join(site,'.wasmbench/history-baseline-'));
  const finish=[];
  try {
    const current=join(site,'data/wasmbench'),{reports}=await validateData(current);
    const runtimes=(await config()).collection.runtimes.filter(id=>id!=='wago');
    for(const name of ['history','history-hub']){
      const source=join(site,'data',name),staged=join(temporary,name);
      if(await stageHistoryBaseline(source,current,reports,staged,runtimes)){
        finish.push(await installDirectory(staged,source));
        console.log(`Updated ${name} fixed baseline; weekly Wago reports unchanged.`);
      }
    }
    for(const f of finish)await f(false);
  }catch(error){for(const f of finish.reverse())await f(true);throw error;}
  finally{await rm(temporary,{recursive:true,force:true});}
});
