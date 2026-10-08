// Collection completion and scientific outcomes remain separate. Complete
// failed/unsupported cells can be published; an interrupted pass cannot.
export function collectionVerdict(rows, scenarios=['steady']) {
  const measured=rows.filter(row=>scenarios.includes(row.scenario));
  return rows.some(row=>Object.entries(row.outcomes||{}).some(([status,count])=>count>0&&!['ok','unsupported'].includes(status)))
    ? 'FAIL'
    : measured.length&&measured.every(row=>row.median_ns_per_operation!=null)
      ? 'PASS' : measured.length ? 'UNSUPPORTED' : 'NOT MEASURED';
}
