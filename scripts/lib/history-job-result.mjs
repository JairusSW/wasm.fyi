// Recorded failures are terminal workload outcomes, not an incomplete sweep.
export function completedHistoryJob(result, workloadCount) {
  return ['completed', 'completed-with-errors'].includes(result?.status)
    && result.completed === workloadCount;
}
