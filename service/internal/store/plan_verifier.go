package store

import "github.com/JairusSW/wasm.fyi/service/internal/wire"

const planVerificationCacheBytes = 4 << 20
const planVerificationCacheEntries = 2

type verifiedPlan struct {
	scope wire.PlanScope
	cost  int
}

// This cache belongs to one validation pass. It never carries proof across
// startup, backup, cleanup or rebuild, and retains no raw source plan bytes.
type planVerifier struct {
	fetch   func(wire.Object) ([]byte, error)
	entries map[string]verifiedPlan
	order   []string
	bytes   int
}

func clonePlanScope(scope wire.PlanScope) wire.PlanScope {
	scope.Members = append([]string{}, scope.Members...)
	scope.Corpora = append([]string{}, scope.Corpora...)
	return scope
}
func planScopeCost(scope wire.PlanScope) int {
	// Conservative accounting includes maps, slice entries, string storage and
	// object overhead. Names are bounded by the source wire validator.
	cost := 512 + 2*(len(scope.Plan)+len(scope.ConfiguredHarnessPin))
	for _, names := range [][]string{scope.Members, scope.Corpora} {
		for _, name := range names {
			cost += 256 + 2*len(name)
		}
	}
	return cost
}
func (v *planVerifier) verify(job wire.Job) (wire.PlanScope, error) {
	var empty wire.PlanScope
	if job.SessionPlan == nil {
		return empty, wire.Invalid("missing session plan")
	}
	if e := job.SessionPlan.Validate(); e != nil {
		return empty, e
	}
	transport, e := wire.Encode(job.SessionPlan)
	if e != nil {
		return empty, e
	}
	keyBytes, e := wire.Encode([]string{job.Plan, job.ConfiguredHarnessPin, wire.Hash(transport)})
	if e != nil {
		return empty, e
	}
	key := wire.Hash(keyBytes)
	if cached, ok := v.entries[key]; ok {
		if !cached.scope.Contains(job.Machine, job.Corpus) {
			return empty, wire.Invalid("job outside session plan")
		}
		return clonePlanScope(cached.scope), nil
	}
	scope, e := job.SessionPlan.Verify(job, v.fetch)
	if e != nil {
		return empty, e
	}
	cost := planScopeCost(scope)
	if cost <= planVerificationCacheBytes {
		if v.entries == nil {
			v.entries = map[string]verifiedPlan{}
		}
		for len(v.order) >= planVerificationCacheEntries || v.bytes+cost > planVerificationCacheBytes {
			oldest := v.order[0]
			v.order = v.order[1:]
			v.bytes -= v.entries[oldest].cost
			delete(v.entries, oldest)
		}
		v.entries[key] = verifiedPlan{scope: clonePlanScope(scope), cost: cost}
		v.order = append(v.order, key)
		v.bytes += cost
	}
	return scope, nil
}
