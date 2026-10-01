export function withholdFailedCells(summaries) {
  return summaries.map(summary => {
    const failed = Object.entries(summary.outcomes || {}).some(([status,count]) => !['ok','unsupported'].includes(status) && count > 0);
    return failed ? {...summary,median_ns_per_operation:null,ci95_low:null,ci95_high:null,
      latency_status:'failed_cell',latency_reason:'At least one trial failed; successful raw samples remain evidence but do not establish a headline value for this cell.'} : summary;
  });
}
