import assert from 'node:assert/strict';

// A weekly reference names the producer report digest, while the site's report
// filename is a different identity. Resolve both from the retained inventory.
export function retainedHistoryBindings(weekly, reports) {
 const bySource=new Map();
 for(const report of reports){let list=bySource.get(report.source);if(!list)bySource.set(report.source,list=[]);if(!list.some(r=>r.oldId===report.oldId))list.push(report)}
 const bindings=new Map();
 for(const point of weekly.results){
 const engines=point.engines||(!point.reports?.length?{}:{wago:{status:point.status,revision:point.revision,reports:point.reports,source:point.version&&point.releasePublishedAt?{targetType:'release',tag:point.version,publishedAt:point.releasePublishedAt,url:`https://github.com/wago-org/wago/releases/tag/${encodeURIComponent(point.version)}`}:{targetType:'main'}}});
 for(const [runtime,engine] of Object.entries(engines)){
  if(engine.status!=='measured')continue;
  for(const ref of engine.reports||[]){
   const matches=(bySource.get(ref.reportSha256)||[]).filter(r=>!ref.runId||!r.run||r.run===ref.runId||ref.runId.startsWith(r.run+'-'));
   assert.equal(matches.length,1,`Historical producer reference must resolve uniquely: ${ref.reportSha256} ${ref.runId}`);
   const key=matches[0].oldId,source=engine.source||{},role=source.targetType==='main'?'source':'release';
   const row={runtime,date:point.targetWeek.slice(0,10),role,...(engine.revision?{revision:engine.revision}:{}),...(source.committedAt?{sourceDate:source.committedAt}:{}),...(role==='release'&&source.tag&&source.publishedAt&&source.url?{release:{version:source.tag,publishedAt:source.publishedAt,url:source.url}}:{})};
   let rows=bindings.get(key);if(!rows)bindings.set(key,rows=[]);
   if(!rows.some(r=>JSON.stringify(r)===JSON.stringify(row)))rows.push(row);
  }
 }
 }
 return bindings;
}
