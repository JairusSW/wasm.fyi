/** Filters use a fixed candidate pool, never the output of another percentile rule. */
export const FILTER_METRICS = ['steady', 'compile', 'inst', 'first', 'rss', 'code', 'pass'] as const;
export type FilterMetric = typeof FILTER_METRICS[number];
export interface RuntimeFilterRule { metric: FilterMetric; top: number; limit: number | null }
export interface RuntimeFilters { name: string; rules: RuntimeFilterRule[] }
export interface RuntimeFilterRow { id: string; name: string; values: Partial<Record<FilterMetric, number | null>> }
export const emptyRuntimeFilters = (): RuntimeFilters => ({name: '', rules: []});
export function parseRuntimeFilters(raw: string): RuntimeFilters | undefined {
 try {
  if(raw.length>4096)return;
  const value=JSON.parse(raw);
  if(typeof value.name!=='string'||value.name.length>200||!Array.isArray(value.rules)||value.rules.length>8)return;
  const rules:RuntimeFilterRule[]=[];
  for(const r of value.rules){
   if(!r||!FILTER_METRICS.includes(r.metric)||!Number.isFinite(r.top)||r.top<=0||r.top>100||
    (r.limit!==null&&(!Number.isFinite(r.limit)||r.limit<0||(r.metric==='pass'&&r.limit>100))))return;
   rules.push({metric:r.metric,top:r.top,limit:r.limit});
  }
  return {name:value.name,rules};
 }catch{return}
}
/** Top N% = ceil(N% × measured candidates), with every tie at the cutoff included. */
export function filterRuntimes(rows: readonly RuntimeFilterRow[], filters: RuntimeFilters): Set<string> {
 const alternatives=filters.name.toLowerCase().split(',').map(part=>part.trim().split(/\s+/).filter(Boolean)).filter(words=>words.length);
 const pool=rows.filter(row=>!alternatives.length||alternatives.some(words=>words.every(word=>row.name.toLowerCase().includes(word))));
 const valid=(v:number|null|undefined):v is number=>v!=null&&Number.isFinite(v)&&v>=0;
 const cutoffs=filters.rules.map(rule=>{
  const values=pool.map(row=>row.values[rule.metric]).filter(valid).sort((a,b)=>rule.metric==='pass'?b-a:a-b);
  return values[Math.max(0,Math.ceil(values.length*rule.top/100)-1)];
 });
 return new Set(pool.filter(row=>filters.rules.every((rule,i)=>{
  const v=row.values[rule.metric],cutoff=cutoffs[i];
  if(!valid(v)||cutoff==null)return false;
  return rule.metric==='pass'?v>=cutoff&&(rule.limit==null||v>=rule.limit):v<=cutoff&&(rule.limit==null||v<=rule.limit);
 })).map(row=>row.id));
}
