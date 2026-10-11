import {sweepWeeks,releaseInWeek,deduplicateSweep} from './weekly-release-sweep.mjs';
import {nearestCommit,nearestCommitSearchUntil} from './history-scope.mjs';
import {monthsBefore} from './weekly-history.mjs';

// Inject upstream I/O so the calendar and provenance rules can be verified
// without network access or building an engine.
export async function planWeeklyEngine(engine,spec,calendar,upstream){
 const pins=[];
 const releases=await upstream.releases(engine);
 const branch=await upstream.defaultBranch(spec.repository);
 for(const week of calendar.weeks){
  const base={engine,repository:spec.repository,configurations:spec.configurations,targetWeek:week.end,weekStart:week.start,weekEnd:week.end};
  try{
   const release=releaseInWeek(engine,releases,week);
   if(release){
    const revision=await upstream.releaseRevision(engine,spec,release);
    if(!/^[a-f0-9]{40}$/i.test(revision))throw Error('Release did not resolve to a full commit hash');
    pins.push({...base,status:'planned',targetType:'release',tag:release.tag_name,revision:revision.toLowerCase(),publishedAt:release.published_at,url:release.html_url,prerelease:!!release.prerelease,datePrecision:release.datePrecision||'second',dateBasis:'git-tag-commit',embeddedV8:release.embeddedV8});
   }else{
    // Snapshot dates bound history; a dormant engine can have older source.
    // Keep the one-year source-age limit relative to the weekly snapshot.
    const sourceBounds={...calendar,sourceCutoff:monthsBefore(week.end,12)};
    const prior=(await upstream.commits(spec.repository,branch,week.end,1))[0];
    const until=nearestCommitSearchUntil(prior,week.end,sourceBounds);
    const candidates=[...([prior].filter(Boolean)),...(until===new Date(week.end).toISOString()?[]:await upstream.commits(spec.repository,branch,until,100,week.end))];
    const selected=nearestCommit(candidates,week.end,sourceBounds);
    if(!selected){pins.push({...base,targetType:'main',status:'unavailable',branch,reason:'No eligible default-branch commit existed by this weekly target within the one-year source-age limit.'});continue;}
    pins.push({...base,targetType:'main',status:'planned',branch,revision:selected.sha.toLowerCase(),committedAt:selected.commit?.committer?.date||selected.commit?.author?.date,url:selected.html_url});
   }
  }catch(error){pins.push({...base,status:'unavailable',reason:String(error.message||error)});}
 }
 return deduplicateSweep(pins);
}

export function newWeeklyPlan(anchor=new Date().toISOString()){
 return {...sweepWeeks(anchor,6),policy:'Newest to oldest, one eligible release per week; otherwise the default-branch commit closest to Sunday 06:00 America/New_York. Current partial week ends at the frozen anchor. Identical commits are measured once per machine, backend and workload contract.',machines:['local-arm64','hub-amd64','remote-amd64'],engines:[],pins:[]};
}
