import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists } from './wasmbench.mjs';
import { validateData } from './validate-data.mjs';
import { writeIndex } from './snapshot-index.mjs';

/** Update only the fixed current comparison; retrospective Wago evidence stays pinned. */
export async function stageHistoryBaseline(source, currentDirectory, currentReports, staged, runtimeIds) {
  if (!await exists(join(source,'weekly.json'))) return false;
  const history=await validateData(source);
  const weekly=JSON.parse(await readFile(join(source,'weekly.json'),'utf8'));
  const prior=history.reports.find(r=>r.id===weekly.baseline.report);
  if(!prior)throw new Error('Missing prior history baseline');
  const host=r=>JSON.stringify([r.host.hostname,r.host.os,r.host.arch]);
  const cohort=r=>JSON.stringify(r.workloads.map(w=>[w.id,w.sha256]).sort((a,b)=>a[0].localeCompare(b[0])));
  const candidate=[...currentReports].sort((a,b)=>b.created.localeCompare(a.created)).find(r=>host(r)===host(prior) && cohort(r)===cohort(prior) && runtimeIds.every(id=>r.runtimes.some(c=>c.id===id)));
  if(!candidate || candidate.id===prior.id)return false;
  const reports=[...history.reports.filter(r=>r.id!==prior.id),candidate];
  await mkdir(staged,{recursive:true});
  for(const r of reports)await cp(join(r.id===candidate.id?currentDirectory:source,r.evidence),join(staged,r.evidence));
  await writeIndex(staged,reports);
  weekly.baseline={report:candidate.id,runId:candidate.runId,evidenceSha256:candidate.evidenceSha256,created:candidate.created,configurations:candidate.runtimes.filter(r=>r.id!=='wago')};
  await writeFile(join(staged,'weekly.json'),JSON.stringify(weekly,null,2)+'\n');
  await validateData(staged);
  return true;
}
