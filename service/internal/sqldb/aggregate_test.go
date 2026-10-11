package sqldb

import (
	"context"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"math"
	"testing"
)

func aggregateFixture() *aggregateSnapshot {
	a := &aggregateConfiguration{engine: "a", version: "1", backend: "jit"}
	b := &aggregateConfiguration{engine: "b", version: "2", backend: "jit"}
	d := &aggregateConfiguration{engine: "interpreter", version: "1", backend: "interpreter"}
	out := &aggregateSnapshot{engines: map[string]*aggregateConfiguration{"a": a, "b": b, "interpreter": d}}
	for i, v := range []float64{4, 16, 64} {
		for _, cfg := range []*aggregateConfiguration{a, b} {
			value := v
			if cfg == b {
				value *= 2
			}
			group := "x"
			if i == 2 {
				group = "y"
			}
			out.rows = append(out.rows, aggregateScalar{cfg: cfg, workload: fmt.Sprint("workload/", i), contract: fmt.Sprint(i), group: group, phase: "steady", capturedAt: "2026-10-10T00:00:00Z", latency: value, code: value, latOK: true, codeOK: true})
		}
	}
	return out
}
func card(r AggregateResult, engine string) AggregateCard {
	for _, c := range r.Cards {
		if c.Engine == engine {
			return c
		}
	}
	return AggregateCard{}
}
func closeFloat(a, b float64) bool { return math.Abs(a-b) <= 1e-12*math.Max(1, math.Abs(b)) }
func TestAggregateWeightedSharedPerEngineAndCodeNA(t *testing.T) {
	data := aggregateFixture()
	q := AggregateQuery{Metric: "steady", Engines: []string{"a", "b", "interpreter"}, Baseline: "a", Weighting: "corpus", Cohort: "shared", Average: "geo"}
	r := computeAggregate(data, q)
	if len(r.Workloads) != 3 || len(r.Participants) != 2 || card(r, "a").Count != 3 || !closeFloat(*card(r, "a").Value, math.Sqrt(math.Sqrt(4*16)*64)) || !closeFloat(*card(r, "b").Ratio, 2) {
		t.Fatal(r)
	}
	q.Weighting = "workload"
	q.Average = "mean"
	r = computeAggregate(data, q)
	if !closeFloat(*card(r, "a").Value, 28) {
		t.Fatal(r)
	}
	data.rows[3].latOK = false
	r = computeAggregate(data, q)
	if card(r, "a").Count != 2 || card(r, "b").Count != 2 || !closeFloat(*card(r, "a").Value, 34) {
		t.Fatal(r)
	}
	q.Cohort = "per-engine"
	r = computeAggregate(data, q)
	if card(r, "a").Count != 3 || card(r, "b").Count != 2 || !closeFloat(*card(r, "b").Ratio, 68.0/28) {
		t.Fatal(r)
	}
	for i := range data.rows {
		data.rows[i].phase = "compile"
	}
	q.Metric = "code"
	q.Cohort = "shared"
	r = computeAggregate(data, q)
	if len(r.Participants) != 2 || card(r, "interpreter").Value != nil || card(r, "a").Count != 3 {
		t.Fatal(r)
	}
	for i := range data.rows {
		data.rows[i].phase = "steady"
	}
	data.rows[0].latency = 0
	data.rows[0].latOK = false
	q.Metric = "steady"
	q.Weighting = "corpus"
	q.Cohort = "shared"
	r = computeAggregate(data, q)
	if card(r, "a").Count != 1 {
		t.Fatal(r)
	}
}
func TestRSSAverageArithmeticPerPhaseSharedIntersection(t *testing.T) {
	a := &aggregateConfiguration{engine: "a"}
	b := &aggregateConfiguration{engine: "b"}
	data := &aggregateSnapshot{engines: map[string]*aggregateConfiguration{"a": a, "b": b}}
	for i, p := range phases {
		for _, cfg := range []*aggregateConfiguration{a, b} {
			v := float64(i+1) * 10
			if cfg == b {
				v *= 2
			}
			data.rows = append(data.rows, aggregateScalar{cfg: cfg, workload: "app/one", contract: "same", group: "one", phase: p, memory: v, memOK: true})
		}
	}
	data.rows[3].memOK = false
	q := AggregateQuery{Metric: "rssAverage", Engines: []string{"a", "b"}, Baseline: "a", Cohort: "shared", Weighting: "corpus", Average: "geo"}
	r := computeAggregate(data, q)
	if card(r, "a").Count != 3 || !closeFloat(*card(r, "a").Value, 80.0/3) || !closeFloat(*card(r, "b").Ratio, 2) {
		t.Fatal(r)
	}
	q.Cohort = "per-engine"
	r = computeAggregate(data, q)
	if card(r, "a").Count != 4 || *card(r, "a").Value != 25 || card(r, "b").Count != 3 {
		t.Fatal(r)
	}
}
func TestAggregateNewestGlobalSnapshotExcludesOldFeatureCallsAndCacheMutation(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	for i, name := range []string{"apps/old-one", "apps/old-two", "features/test", "mechanisms/call"} {
		c := fixture()
		c.Results[0].SamplesNs = nil
		c.Results[0].Sampling = nil
		c.Results[0].TimingSamples = 0
		c.Results[0].Workload = name
		c.Results[0].Contract = fmt.Sprintf("%064x", 10+i)
		if _, e = s.Put(ctx, c); e != nil {
			t.Fatal(e)
		}
	}
	newest := fixture()
	newest.Results[0].SamplesNs = nil
	newest.Results[0].Sampling = nil
	newest.Results[0].TimingSamples = 0
	newest.Results[0].Workload = "apps/new"
	newest.Results[0].Contract = fmt.Sprintf("%064x", 20)
	src := *newest.Source
	src.AsOf = "2026-10-06T00:00:00Z"
	newest.Source = &src
	if _, e = s.Put(ctx, newest); e != nil {
		t.Fatal(e)
	}
	q := AggregateQuery{Platform: hash(newest.Platform), Metric: "steady", Baseline: "wazero"}
	r, e := s.Aggregate(ctx, q)
	if e != nil || len(r.Workloads) != 1 || r.Workloads[0] != "apps/new" || len(r.Cards) != 1 || r.Cards[0].Count != 1 || r.Cards[0].Source.AsOf != src.AsOf {
		t.Fatal(r, e)
	}
	*r.Cards[0].Value = 999
	r.Workloads[0] = "mutated-workload"
	r.Participants[0] = "mutated-engine"
	r.Cards[0].Source.AsOf = "mutated"
	again, e := s.Aggregate(ctx, q)
	if e != nil || !closeFloat(*again.Cards[0].Value, 10) || again.Cards[0].Source.AsOf != src.AsOf || len(again.Workloads) != 1 || again.Workloads[0] != "apps/new" || len(again.Participants) != 1 || again.Participants[0] != "wazero" {
		t.Fatal(again, e)
	}
	newest.CapturedAt = "2026-10-11T00:00:00Z"
	v := 25.0
	newest.Results[0].Value = &v
	if _, e = s.Put(ctx, newest); e != nil {
		t.Fatal(e)
	}
	again, e = s.Aggregate(ctx, q)
	if e != nil || !closeFloat(*again.Cards[0].Value, 25) || again.Revision == r.Revision {
		t.Fatal(again, e)
	}
	var n int
	s.reader.QueryRow("SELECT count(*) FROM sample_vectors").Scan(&n)
	if n != 0 {
		t.Fatal("aggregate loaded/fabricated vectors", n)
	}
	_ = benchdb.ErrChanged
}

func TestAggregateOtherPlatformWritesRetainSnapshotCache(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	a := fixture()
	if _, e = s.Put(ctx, a); e != nil {
		t.Fatal(e)
	}
	q := AggregateQuery{Platform: hash(a.Platform), Metric: "steady"}
	result, e := s.Aggregate(ctx, q)
	if e != nil {
		t.Fatal(e)
	}
	key := "snapshot/" + q.Platform + "/" + result.Revision
	original := s.aggregateCache[key].snapshot
	if original == nil {
		t.Fatal("missing cached snapshot")
	}
	b := fixture()
	b.Platform.CPU = "Other"
	if _, e = s.Put(ctx, b); e != nil {
		t.Fatal(e)
	}
	again, e := s.Aggregate(ctx, q)
	if e != nil || again.Revision != result.Revision || s.aggregateCache[key].snapshot != original {
		t.Fatal("other host cache lost", again, e)
	}
	a.CapturedAt = "2026-10-11T00:00:00Z"
	v := 40.0
	a.Results[0].Value = &v
	if _, e = s.Put(ctx, a); e != nil {
		t.Fatal(e)
	}
	again, e = s.Aggregate(ctx, q)
	if e != nil || again.Revision == result.Revision || !closeFloat(*again.Cards[0].Value, 40) {
		t.Fatal("same host stale", again, e)
	}
}

func TestHistoryOnlyImportsKeepLatestMatrixAndAggregateRevision(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	latest := fixture()
	if _, e = s.Put(ctx, latest); e != nil {
		t.Fatal(e)
	}
	q := AggregateQuery{Platform: hash(latest.Platform), Metric: "steady"}
	a, e := s.Aggregate(ctx, q)
	if e != nil {
		t.Fatal(e)
	}
	key := "snapshot/" + q.Platform + "/" + a.Revision
	original := s.aggregateCache[key].snapshot
	matrix, e := s.Matrix(ctx, MatrixQuery{Platform: q.Platform, Limit: 10})
	if e != nil {
		t.Fatal(e)
	}
	before, _ := s.Summary(ctx)
	old := fixture()
	old.CapturedAt = "2026-10-12T00:00:00Z"
	src := *old.Source
	src.AsOf = "2026-09-01T00:00:00Z"
	old.Source = &src
	if _, e = s.Put(ctx, old); e != nil {
		t.Fatal(e)
	}
	after, _ := s.Summary(ctx)
	if before.Platforms[0].LatestRevision != after.Platforms[0].LatestRevision || before.Platforms[0].HistoryRevision == after.Platforms[0].HistoryRevision || before.Revision == after.Revision {
		t.Fatal(before, after)
	}
	again, e := s.Aggregate(ctx, q)
	if e != nil || again.Revision != a.Revision || s.aggregateCache[key].snapshot != original {
		t.Fatal(again, e)
	}
	current, e := s.Matrix(ctx, MatrixQuery{Platform: q.Platform, Limit: 10})
	if e != nil || current.Revision != matrix.Revision {
		t.Fatal(current, e)
	}
}
