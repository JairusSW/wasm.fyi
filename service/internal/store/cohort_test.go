package store

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func publishCohort(t *testing.T, s *Store, seed string, cells []testutil.CohortCell) string {
	return publishCohortAt(t, s, seed, time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC), cells)
}

func TestCohortRSSUnequalAndMatchedPopulations(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := publishCohort(t, s, "rss", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Metric: "process.rss", Scenario: "compile", Value: 10}, {Runtime: "b", Workload: "fixture/one", Group: "x", Metric: "process.rss", Scenario: "compile", Value: 20}, {Runtime: "a", Workload: "fixture/one", Group: "x", Metric: "process.rss", Scenario: "steady", Value: 30}})
	scope := cohortScope(t, s, rev)
	scope.Policy = "available-rss-arithmetic-v1"
	scope.Collectors = "require-recorded"
	rows, _ := s.Results(Query{Revision: rev}, false)
	selectors := map[CohortSelector]bool{}
	scope.Selectors = nil
	for _, r := range rows {
		var v wire.Result
		_ = wire.Decode(r.Data, &v)
		sel := CohortSelector{v.MetricDefinitionID, v.MeasurementMethodID, v.AnalysisVersion}
		if !selectors[sel] {
			selectors[sel] = true
			scope.Selectors = append(scope.Selectors, sel)
		}
	}
	c, e := s.ComputeCohort(context.Background(), scope)
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range c.Comparison.Populations {
		want := 1
		if p.Configuration == scope.Baseline {
			want = 2
		}
		if p.Count != want || p.Workloads != 1 || *p.Value != 20 || *p.Ratio != 1 {
			t.Fatal("unequal RSS population hidden", p)
		}
	}
	scope.Policy = "matched-rss-arithmetic-v1"
	c, e = s.ComputeCohort(context.Background(), scope)
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range c.Comparison.Populations {
		if p.Count != 1 {
			t.Fatal("RSS matching failed")
		}
		if p.Configuration != scope.Baseline && *p.Ratio != 2 {
			t.Fatal("matched RSS ratio drifted")
		}
	}
}

func TestCohortNativePrecisionAndRebuild(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := publishCohort(t, s, "native", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Metric: "native.code_size", ExactValue: "9007199254740993"}})
	scope := cohortScope(t, s, rev)
	scope.Collectors = "allow-unrecorded-native-size"
	scope.Definitions = "allow-unregistered-native-size"
	c, e := s.ComputeCohort(context.Background(), scope)
	if e != nil {
		t.Fatal(e)
	}
	member := c.Comparison.Populations[0].Members[0]
	if string(member.Cell.SourceValue) != `"9007199254740993"` || !member.Cell.ApproximateValue {
		t.Fatal("exact measured integer silently rounded")
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(context.Background(), backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "test"); e != nil {
		t.Fatal(e)
	}
	r := openTest(t, rebuilt)
	defer r.Close()
	restored, e := r.ComputeCohort(context.Background(), scope)
	if e != nil || restored.Digest != c.Digest {
		t.Fatal("cohort method index not portable", e)
	}
}
func publishCohortAt(t *testing.T, s *Store, seed string, date time.Time, cells []testutil.CohortCell) string {
	t.Helper()
	job, objects, e := testutil.CohortFixture(seed, date, cells)
	if e != nil {
		t.Fatal(e)
	}
	for id, b := range objects {
		if e = s.Install(id, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	rev, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	return rev
}

func cohortScope(t *testing.T, s *Store, rev string) CohortScope {
	t.Helper()
	rows, e := s.Results(Query{Revision: rev}, false)
	if e != nil {
		t.Fatal(e)
	}
	scope := CohortScope{Revision: rev, Selection: "current", LaneKind: "track", Policy: "shared-geometric-v1", Weighting: "workload", Workloads: "applications", MixedConfigurations: "reject", Collectors: "allow-unrecorded-timing", Definitions: "require-registered", Contracts: "latest-in-scope"}
	lanes := map[string]bool{}
	for _, r := range rows {
		var v wire.Result
		_ = json.Unmarshal(r.Data, &v)
		scope.Environment = v.EnvironmentID
		scope.Selectors = []CohortSelector{{v.MetricDefinitionID, v.MeasurementMethodID, v.AnalysisVersion}}
		lanes[v.TrackID] = true
		if v.Runtime == "a" {
			scope.Baseline = v.TrackID
		}
	}
	for id := range lanes {
		scope.Lanes = append(scope.Lanes, id)
	}
	return scope
}

func TestCohortMultipleReportsContractsWeightsAndFrozenScope(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	publishCohort(t, s, "one", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Value: 4}, {Runtime: "b", Workload: "fixture/one", Group: "x", Value: 16}})
	rev := publishCohort(t, s, "two", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/two", Group: "y", Value: 16}, {Runtime: "b", Workload: "fixture/two", Group: "y", Value: 64}})
	scope := cohortScope(t, s, rev)
	c, e := s.ComputeCohort(context.Background(), scope)
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range c.Comparison.Populations {
		want := 32.0
		if p.Configuration == scope.Baseline {
			want = 8
		}
		if p.Count != 2 || len(p.Reports) != 2 || p.Value == nil || math.Abs(*p.Value-want) > 1e-10 {
			t.Fatal("multi-report cohort drift", p)
		}
		for _, m := range p.Members {
			if !wire.IsHash(m.Cell.ExactConfiguration) || !wire.IsHash(m.Cell.Contract) || !wire.IsHash(m.Cell.Method) {
				t.Fatal("membership lacks exact provenance")
			}
		}
	}
	publishCohortAt(t, s, "changed-contract", time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "b", Workload: "fixture/one", ContractRevision: "changed", Group: "x", Value: 400}})
	frozen, e := s.ComputeCohort(context.Background(), scope)
	if e != nil || frozen.Digest != c.Digest {
		t.Fatal("new publication changed frozen cohort")
	}
	scope.Revision = s.Current()
	changed, e := s.ComputeCohort(context.Background(), scope)
	if e != nil || changed.Comparison.Populations[0].Count != 1 || changed.Excluded["superseded-contract"] != 2 {
		t.Fatal("different contracts matched", e)
	}
}

func TestCohortCompatibilityAndExcludedFailures(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := publishCohort(t, s, "coverage", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Value: 4}, {Runtime: "b", Workload: "fixture/one", Group: "x", Value: 16}, {Runtime: "a", Workload: "fixture/two", Group: "x", Value: 16}, {Runtime: "b", Workload: "fixture/two", Group: "x", Value: 64, Failed: true}})
	scope := cohortScope(t, s, rev)
	c, e := s.ComputeCohort(context.Background(), scope)
	if e != nil || c.Excluded["failed-launch"] != 1 || c.Comparison.Populations[0].Count != 1 {
		t.Fatal("failed launch earned performance credit", e)
	}
	scope.Collectors = "require-recorded"
	if _, e = s.ComputeCohort(context.Background(), scope); e == nil {
		t.Fatal("collector inferred")
	}
	scope.Collectors = "allow-unrecorded-timing"
	scope.Selectors[0].Analysis = "other-analysis"
	if _, e = s.ComputeCohort(context.Background(), scope); e == nil {
		t.Fatal("mixed analysis concealed")
	}
	scope = cohortScope(t, s, rev)
	publishCohort(t, s, "mixed", []testutil.CohortCell{{Runtime: "a", Version: "new", Workload: "fixture/three", Group: "x", Value: 100}})
	scope.Revision = s.Current()
	if _, e = s.ComputeCohort(context.Background(), scope); e == nil {
		t.Fatal("mixed exact configurations concealed")
	}
	scope.MixedConfigurations = "explicit-membership"
	if _, e = s.ComputeCohort(context.Background(), scope); e != nil {
		t.Fatal(e)
	}
}

func TestCohortLatestContractAmbiguityUsesOnlyLatestTime(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := publishCohort(t, s, "ambiguous", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", ContractRevision: "one", Group: "x", Value: 4}, {Runtime: "b", Workload: "fixture/one", ContractRevision: "two", Group: "x", Value: 16}})
	scope := cohortScope(t, s, rev)
	if _, e := s.ComputeCohort(context.Background(), scope); e == nil {
		t.Fatal("ambiguous current contract selected arbitrarily")
	}
	rev = publishCohortAt(t, s, "newer", time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", ContractRevision: "three", Group: "x", Value: 8}, {Runtime: "b", Workload: "fixture/one", ContractRevision: "three", Group: "x", Value: 32}})
	scope.Revision = rev
	c, e := s.ComputeCohort(context.Background(), scope)
	if e != nil || c.Comparison.Populations[0].Count != 1 || c.Excluded["superseded-contract"] != 2 {
		t.Fatal("superseded ambiguity blocked current contract", e)
	}
}

func TestLatestContractSelectionIgnoresUnrequestedLanesAndExcludedWorkloads(t *testing.T) {
	for _, tc := range []struct {
		name    string
		cells   []testutil.CohortCell
		offset  time.Duration
		feature bool
	}{
		{name: "unrequested-newer", offset: time.Hour, cells: []testutil.CohortCell{{Runtime: "c", Workload: "fixture/one", ContractRevision: "unrequested", Group: "x", Value: 100}}},
		{name: "unrequested-tied", cells: []testutil.CohortCell{{Runtime: "c", Workload: "fixture/one", ContractRevision: "unrequested", Group: "x", Value: 100}}},
		{name: "excluded-features", feature: true, cells: []testutil.CohortCell{{Runtime: "a", Workload: "features/probe", ContractRevision: "a-contract", Group: "x", Value: 1}, {Runtime: "b", Workload: "features/probe", ContractRevision: "b-contract", Group: "x", Value: 2}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			s := openTest(t, filepath.Join(dir, "live"))
			defer s.Close()
			base := publishCohort(t, s, "requested", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Value: 4}, {Runtime: "b", Workload: "fixture/one", Group: "x", Value: 16}})
			scope := cohortScope(t, s, base)
			baseline, err := s.ComputeCohort(context.Background(), scope)
			if err != nil {
				t.Fatal(err)
			}
			next := publishCohortAt(t, s, tc.name, time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC).Add(tc.offset), tc.cells)
			frozen, err := s.ComputeCohort(context.Background(), scope)
			if err != nil || frozen.Digest != baseline.Digest {
				t.Fatal("frozen scope changed", err)
			}
			scope.Revision = next
			check := func(s *Store) {
				t.Helper()
				got, err := s.ComputeCohort(context.Background(), scope)
				if err != nil {
					t.Fatal("outside-scope contract affected comparison", err)
				}
				want, _ := wire.Encode(baseline.Comparison)
				actual, _ := wire.Encode(got.Comparison)
				if !bytes.Equal(want, actual) {
					t.Fatal("outside-scope data changed population, values or membership", string(actual))
				}
				if got.Excluded["superseded-contract"] != 0 {
					t.Fatal("outside-scope contract superseded selected cells")
				}
				if tc.feature && got.Excluded["feature-probe"] != 2 {
					t.Fatal("excluded feature population was lost")
				}
			}
			check(s)
			if tc.feature {
				all := scope
				all.Workloads = "all"
				if _, err := s.ComputeCohort(context.Background(), all); err == nil {
					t.Fatal("included feature contract ambiguity concealed")
				}
			}
			backup := filepath.Join(dir, "backup")
			if _, err = s.Backup(context.Background(), backup); err != nil {
				t.Fatal(err)
			}
			rebuilt := filepath.Join(dir, "rebuilt")
			if err = Rebuild(backup, rebuilt, "fixture"); err != nil {
				t.Fatal(err)
			}
			recovered := openTest(t, rebuilt)
			defer recovered.Close()
			check(recovered)
		})
	}
}
