export function repairedFeatureOutcomes(prior, capture, repairPhases) {
  return prior.outcomes.map(([phase, status]) => [
    phase,
    repairPhases.includes(phase)
      ? capture.results.find(row => row.phase === phase)?.latencyStatus || status
      : status,
  ]);
}

export function featureFailureForOutcomes(prior, outcomes, note) {
  if (note) return note;
  return outcomes.some(([, status]) => status === 'failed') ? prior?.failure : undefined;
}

export function normalizeRepairedFeatureItem(item) {
  if (!item?.failure || item.outcomes?.some(([, status]) => status === 'failed')) return false;
  delete item.failure;
  return true;
}
