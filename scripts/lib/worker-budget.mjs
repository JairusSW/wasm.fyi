export function workersWithinCpuBudget(logicalCpus, requested) {
  if (!Number.isSafeInteger(logicalCpus) || logicalCpus < 1) throw new Error('Invalid logical CPU count');
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('Invalid requested worker count');
  const limit = Math.floor(logicalCpus / 4);
  if (limit < 1) throw new Error(`The one-quarter worker policy requires at least four logical CPUs; found ${logicalCpus}.`);
  return Math.min(requested, limit);
}
