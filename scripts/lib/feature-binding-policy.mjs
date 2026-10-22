function samePin(binding, pin) {
  return binding?.job?.source?.revision === pin.revision
    && binding?.job?.source?.asOf === pin.targetWeek;
}

export function featureBindingsForEngine(bindings, engine, pin) {
  const seen = new Set();
  return bindings.filter(binding => binding.engine === engine && samePin(binding, pin)).filter(binding => {
    const key = [binding.job?.featureProfile || '', binding.job?.controller || binding.plan?.controller || '', binding.job?.harness || binding.plan?.harness || ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function featureBindingForWorkload(candidates, engine, workload) {
  if (!candidates.length) return null;
  if (engine !== 'wamr') return candidates[0];
  const fast = candidates.find(binding => ['fast', undefined, null, ''].includes(binding.job?.featureProfile));
  const classic = candidates.find(binding => binding.job?.featureProfile === 'classic');
  const needsFastInterpreter = workload?.features?.some(feature => feature === 'simd' || feature === 'relaxed-simd');
  return needsFastInterpreter ? fast || classic : classic || fast;
}

export function featureProfileForBinding(binding, engine) {
  if (binding?.job?.featureProfile) return binding.job.featureProfile;
  return engine === 'wamr' ? 'fast' : null;
}

export function missingFeatureBindingProfiles(candidates, engine, workloads) {
  if (engine !== 'wamr') return [];
  const available = new Set(candidates.map(binding => featureProfileForBinding(binding, engine)));
  const required = new Set();
  for (const workload of workloads) {
    if (workload.features?.some(feature => feature === 'simd' || feature === 'relaxed-simd')) required.add('fast');
    else required.add('classic');
  }
  return [...required].filter(profile => !available.has(profile)).sort();
}
