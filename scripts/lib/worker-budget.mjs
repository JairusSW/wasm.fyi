export function workersWithinCpuBudget(logicalCpus, requested, availableCpus = logicalCpus) {
  if (!Number.isSafeInteger(logicalCpus) || logicalCpus < 1) throw new Error('Invalid logical CPU count');
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('Invalid requested worker count');
  if (!Number.isSafeInteger(availableCpus) || availableCpus < 1) throw new Error("Invalid available CPU count");
  const limit = Math.floor(logicalCpus / 4);
  if (limit < 1) throw new Error(`The one-quarter worker policy requires at least four logical CPUs; found ${logicalCpus}.`);
  return Math.min(requested, limit, availableCpus);
}
