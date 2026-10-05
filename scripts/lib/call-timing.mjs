// Dedicated boundary-call batches measure per-call cost with enough operations
// to amortize the timer. Keep failures within that measurement class visible.
export function callTimingCandidates(candidates, workload, metric) {
  if (metric !== 'steady' || !/^mechanisms\/(host-to-wasm-call|wasm-to-host-call)$/.test(workload)) return candidates;
  const batches = candidates.filter(report => report.options.operations >= 1000000);
  return batches.length ? batches : candidates;
}
