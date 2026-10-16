package sqldb

import (
	"context"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"testing"
)

func historyFixture(engine, day string, rev int, values []float64) benchdb.Capture {
	c := fixture()
	c.Source.Revision = fmt.Sprintf("%040x", rev)
	c.Source.AsOf = day + "T10:00:00Z"
	c.CapturedAt = day + "T12:00:00Z"
	base := c.Results[0]
	c.Results = nil
	for i, v := range values {
		row := base
		row.Engine = engine
		row.Version = fmt.Sprint(rev)
		row.Workload = fmt.Sprint("apps/", i)
		row.Contract = fmt.Sprintf("%064x", i+20)
		row.Artifact = fmt.Sprintf("%064x", i+30)
		row.Wasm = fmt.Sprint(i, ".wasm")
		row.SamplesNs = nil
		row.TimingSamples = 0
		row.Sampling = nil
		row.Value = &v
		row.Display = &benchdb.Display{Group: "x"}
		if i == 2 {
			row.Display = &benchdb.Display{Group: "y"}
		}
		if v < 0 {
			row.Value = nil
			row.Status = "failed"
		}
		c.Results = append(c.Results, row)
	}
	return c
}
func historyLaneAt(t *testing.T, s HistoricalSummaryResult, date, engine string) HistoricalLane {
	t.Helper()
	for _, p := range s.Items {
		if p.Date == date {
			for _, v := range p.Lanes {
				if v.Engine == engine {
					return v
				}
			}
		}
	}
	t.Fatal("missing lane", date, engine)
	return HistoricalLane{}
}
func putHistory(t *testing.T, s *Store, c benchdb.Capture) {
	t.Helper()
	if _, e := s.Put(context.Background(), c); e != nil {
		t.Fatal(e)
	}
}
func TestHistoricalFixedCurrentCohortCorpusWeightsAndMatchedPairs(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	for _, engine := range []string{"a", "b"} {
		putHistory(t, s, historyFixture(engine, "2026-10-01", 1, []float64{1, 4, 16}))
		putHistory(t, s, historyFixture(engine, "2026-10-03", 2, []float64{2, -1, 32}))
		putHistory(t, s, historyFixture(engine, "2026-10-10", 3, []float64{4, 16, 64}))
	}
	q := HistoricalQuery{Platform: hash(fixture().Platform), Metric: "exec", Engines: []string{"a", "b"}, Cohort: "shared", Weighting: "corpus", From: "2026-10-01", To: "2026-10-03"}
	r, e := s.HistoricalSummary(ctx, q)
	if e != nil {
		t.Fatal(e)
	}
	a := historyLaneAt(t, r, "2026-10-01", "a")
	b := historyLaneAt(t, r, "2026-10-03", "a")
	if len(r.Workloads) != 3 || a.Count != 3 || a.Reference != 3 || a.Value == nil || !closeFloat(*a.Value, 5.65685424949238) || b.Count != 2 || b.Previous == nil || b.First == nil || b.Previous.Count != 2 || !closeFloat(*b.Previous.Before, 4) || !closeFloat(*b.Previous.After, 8) || !closeFloat(*b.Previous.Ratio, 2) {
		t.Fatal(r)
	}
	report, err := s.HistoricalReport(ctx, q, "a", "2026-09-28", "2026-10-05")
	if err != nil || len(report.Items) != 2 || report.Revision != r.Revision || report.FromDate != "2026-10-01" || report.ToDate != "2026-10-03" || report.Items[0].Workload != "apps/0" || report.Items[1].Workload != "apps/2" || report.Items[0].Ratio != 2 {
		t.Fatal(report, err)
	}
	change, e := s.HistoricalComparison(ctx, q, "2026-09-28", "2026-10-05")
	if e != nil || change.Revision != r.Revision || len(change.Items) != 2 || change.Items[0].FromDate != "2026-10-01" || change.Items[0].ToDate != "2026-10-03" || !closeFloat(*change.Items[0].Before, 4) {
		t.Fatal(change, e)
	}
	r.Items[0].Lanes[0].Source.Ref = "mutation"
	r.Workloads[0] = "mutation"
	again, e := s.HistoricalSummary(ctx, q)
	if e != nil || again.Workloads[0] == "mutation" || again.Items[0].Lanes[0].Source.Ref == "mutation" {
		t.Fatal(again, e)
	}
	// Only the current reference changes the archived shared cohort. Other old
	// engines' gaps must never change a previously recorded lane's population.
	current := historyFixture("b", "2026-10-10", 3, []float64{4, -1, 64})
	current.CapturedAt = "2026-10-11T12:00:00Z"
	putHistory(t, s, current)
	next, e := s.HistoricalSummary(ctx, q)
	if e != nil || next.Revision == r.Revision || historyLaneAt(t, next, "2026-10-01", "a").Count != 2 {
		t.Fatal(next, e)
	}
}
func TestHistoricalCallsSumBothDirectionsSameConfigAndAliasReuse(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c := historyFixture("a", "2026-10-01", 1, []float64{3, 5})
	c.Results[0].Workload = historyHostCall
	c.Results[1].Workload = historyWasmCall
	c.Source.Kind = "release"
	c.Source.Ref = "v1"
	c.Source.DateBasis = "git-tag-commit"
	putHistory(t, s, c)
	alias := c
	src := *c.Source
	src.AsOf = "2026-10-03T10:00:00Z"
	src.Kind = "snapshot"
	src.Ref = "main@000000000000"
	src.DateBasis = ""
	alias.Source = &src
	putHistory(t, s, alias)
	q := HistoricalQuery{Platform: hash(c.Platform), Metric: "callTotal"}
	r, e := s.HistoricalSummary(ctx, q)
	if e != nil {
		t.Fatal(e)
	}
	lane := historyLaneAt(t, r, "2026-10-03", "a")
	if lane.Value == nil || *lane.Value != 8 || lane.Calls == nil || *lane.Calls.HostWasm != 3 || *lane.Calls.WasmHostLoop != 5 || lane.Previous == nil || !lane.Previous.Reused || lane.Fingerprint != historyLaneAt(t, r, "2026-10-01", "a").Fingerprint {
		t.Fatal(r)
	}
	later := historyFixture("a", "2026-10-03", 2, []float64{9})
	later.Results[0].Workload = historyHostCall
	later.Source.AsOf = "2026-10-03T14:00:00Z"
	later.CapturedAt = "2026-10-03T15:00:00Z"
	putHistory(t, s, later)
	r, e = s.HistoricalSummary(ctx, q)
	if e != nil || historyLaneAt(t, r, "2026-10-03", "a").Value != nil {
		t.Fatal("directions mixed across configurations", r, e)
	}
}
func TestHistoricalCodeInterpreterNAFeaturesExcludedAndScopedCaches(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c := historyFixture("jit", "2026-10-01", 1, []float64{3, 5})
	for i := range c.Results {
		c.Results[i].Phase = "compile"
	}
	putHistory(t, s, c)
	interp := c
	interp.Results = append([]benchdb.Row(nil), c.Results...)
	for i := range interp.Results {
		interp.Results[i].Engine = "interp"
		interp.Results[i].Backend = "interpreter"
		interp.Results[i].CodeBytes = nil
		interp.Results[i].CodeKind = nil
		interp.Results[i].CodeStatus = "unsupported"
	}
	putHistory(t, s, interp)
	feature := historyFixture("jit", "2026-10-01", 1, []float64{900})
	feature.Results[0].Workload = "features/simd"
	feature.Results[0].Contract = fmt.Sprintf("%064x", 90)
	feature.Results[0].Artifact = fmt.Sprintf("%064x", 91)
	feature.Results[0].Phase = "compile"
	putHistory(t, s, feature)
	q := HistoricalQuery{Platform: hash(c.Platform), Metric: "code", Cohort: "shared"}
	r, e := s.HistoricalSummary(ctx, q)
	if e != nil || len(r.Workloads) != 2 || historyLaneAt(t, r, "2026-10-01", "jit").Count != 2 || historyLaneAt(t, r, "2026-10-01", "interp").Value != nil {
		t.Fatal(r, e)
	}
	key := "history-summary/" + r.Revision
	old := s.aggregateCache[key].historical
	other := historyFixture("jit", "2026-10-03", 2, []float64{4})
	other.Platform.CPU = "Another host"
	putHistory(t, s, other)
	again, e := s.HistoricalSummary(ctx, q)
	if e != nil || again.Revision != r.Revision || s.aggregateCache[key].historical != old {
		t.Fatal("other host invalidated cache", again, e)
	}
	alias := c
	src := *c.Source
	src.AsOf = "2026-10-02T10:00:00Z"
	alias.Source = &src
	putHistory(t, s, alias)
	again, e = s.HistoricalSummary(ctx, q)
	if e != nil || again.Revision == r.Revision {
		t.Fatal(again, e)
	}
	var vectors int
	if e = s.reader.QueryRow("SELECT count(*) FROM sample_vectors").Scan(&vectors); e != nil || vectors != 0 {
		t.Fatal("summary manufactured vectors", vectors, e)
	}
}
func TestHistoricalComparisonPerEngineSnapsMeasuredDatesAndCoverage(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	for _, x := range []struct {
		engine, date string
		rev          int
		values       []float64
	}{{"a", "2026-10-01", 1, []float64{1, 2}}, {"a", "2026-10-03", 2, []float64{2, -1}}, {"b", "2026-10-02", 1, []float64{1, 2}}, {"b", "2026-10-04", 2, []float64{3, 4}}} {
		putHistory(t, s, historyFixture(x.engine, x.date, x.rev, x.values))
	}
	q := HistoricalQuery{Platform: hash(fixture().Platform), Metric: "cov", Cohort: "per-engine"}
	r, e := s.HistoricalComparison(ctx, q, "2026-10-01", "2026-10-04")
	if e != nil || len(r.Items) != 2 || r.Items[0].FromDate != "2026-10-01" || r.Items[0].ToDate != "2026-10-03" || *r.Items[0].Ratio != .5 || r.Items[1].FromDate != "2026-10-02" || r.Items[1].ToDate != "2026-10-04" {
		t.Fatal(r, e)
	}
	q.Cohort = "shared"
	shared, err := s.HistoricalComparison(ctx, q, "2026-10-01", "2026-10-04")
	if err != nil || len(shared.Items) != 2 || shared.Items[0].Reference != 2 || *shared.Items[0].Ratio != .5 {
		t.Fatal(shared, err)
	}
}

func TestHistoricalDateWindowUsesNumericUTCSourceTime(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c := historyFixture("a", "2026-10-05", 1, []float64{12})
	c.Source.AsOf = "2026-10-05T01:00:00+02:00"
	putHistory(t, s, c)
	q := HistoricalQuery{Platform: hash(c.Platform), From: "2026-10-04", To: "2026-10-04"}
	out, e := s.HistoricalSummary(context.Background(), q)
	if e != nil || len(out.Items) != 1 || out.Items[0].Date != "2026-10-04" || out.Items[0].Lanes[0].Value == nil || *out.Items[0].Lanes[0].Value != 12 {
		t.Fatal(out, e)
	}
}

func TestHistoryMergesHostEnvironmentsWithoutAveragingDuplicates(t *testing.T) {
	ctx := context.Background()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	old := historyFixture("a", "2026-09-01", 1, []float64{1, 4})
	old.Platform.Kernel = "old kernel"
	old.Platform.MemoryBytes = 32710246400
	putHistory(t, s, old)
	current := historyFixture("a", "2026-10-15", 3, []float64{4, 16})
	current.Platform.Kernel = "current kernel"
	current.Platform.MemoryBytes = 32710213632
	putHistory(t, s, current)
	duplicate := old
	duplicate.Platform = current.Platform
	duplicate.CapturedAt = "2026-10-16T00:00:00Z"
	for i := range duplicate.Results {
		value := *duplicate.Results[i].Value * 2
		duplicate.Results[i].Value = &value
	}
	putHistory(t, s, duplicate)
	q := HistoricalQuery{Platform: hash(current.Platform), Platforms: []string{hash(old.Platform), hash(current.Platform), hash(old.Platform)}, Metric: "exec", Engines: []string{"a"}, Average: "mean", Cohort: "per-engine", Weighting: "workload"}
	r, err := s.HistoricalSummary(ctx, q)
	if err != nil {
		t.Fatal(err)
	}
	before := historyLaneAt(t, r, "2026-09-01", "a")
	after := historyLaneAt(t, r, "2026-10-15", "a")
	if len(r.Items) != 2 || before.Count != 2 || before.Value == nil || *before.Value != 5 || after.Value == nil || *after.Value != 10 {
		t.Fatal(r)
	}
	report, err := s.HistoricalReport(ctx, q, "a", "2026-09-01", "2026-10-15")
	if err != nil || report.Revision != r.Revision || len(report.Items) != 2 || report.Items[0].Before != 2 || report.Items[0].After != 4 {
		t.Fatal(report, err)
	}
	// An import into the older environment must invalidate the merged result.
	next := historyFixture("a", "2026-09-08", 2, []float64{3, 12})
	next.Platform = old.Platform
	putHistory(t, s, next)
	changed, err := s.HistoricalSummary(ctx, q)
	if err != nil || len(changed.Items) != 3 || changed.Revision == r.Revision {
		t.Fatal(changed, err)
	}
	// A single-environment request remains exact and has no old-only week.
	single, err := s.HistoricalSummary(ctx, HistoricalQuery{Platform: hash(current.Platform), Metric: "exec", Engines: []string{"a"}})
	if err != nil || len(single.Items) != 2 {
		t.Fatal(single, err)
	}
	other := current
	other.Platform.CPU = "Different CPU"
	putHistory(t, s, other)
	q.Platforms = []string{hash(other.Platform)}
	if _, err = s.HistoricalSummary(ctx, q); err == nil {
		t.Fatal("mixed machines accepted")
	}
}
