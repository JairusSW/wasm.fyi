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
)

func oneHistoryScope(t *testing.T, s *Store, revision string) CohortScope {
	scope := cohortScope(t, s, revision)
	scope.Lanes = []string{scope.Baseline}
	return scope
}
func TestHistoryChangeMatchesContractsInsteadOfUnrelatedAverages(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	first := publishCohortAt(t, s, "history-change-before", time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "a", Workload: "fixture/shared", Value: 10}, {Runtime: "a", Workload: "fixture/before-only", Value: 10000}})
	// Keep an unrelated old value in after's selected population. An explicit
	// current/previous comparison shares only the workload with two captures.
	last := publishCohortAt(t, s, "history-change-after", time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "a", Workload: "fixture/shared", Value: 20}, {Runtime: "a", Workload: "fixture/after-only", Value: 0.001}})
	before := oneHistoryScope(t, s, first)
	after := oneHistoryScope(t, s, last)
	change, e := s.CompareHistory(ctx, before, after)
	if e != nil {
		t.Fatal(e)
	}
	if change.MatchedCells != 2 || change.AfterOnlyCells != 1 || change.ReusedCells != 1 {
		t.Fatal(change)
	}
	// The old before-only result remains selected after publication; it is
	// explicitly reused, not a fresh independent observation.
	before.Revision = last
	before.Selection = "previous"
	change, e = s.CompareHistory(ctx, before, after)
	if e != nil {
		t.Fatal(e)
	}
	if change.MatchedCells != 1 || change.MatchedWorkloads != 1 || change.Before == nil || math.Abs(*change.Before-10) > 1e-10 || change.After == nil || math.Abs(*change.After-20) > 1e-10 || change.Ratio == nil || math.Abs(*change.Ratio-2) > 1e-10 || change.ReusedCells != 0 || change.Uncertainty != "unavailable" {
		t.Fatal(change)
	}
	incompatible := after
	incompatible.Environment = "bad"
	if _, e = s.CompareHistory(ctx, before, incompatible); e == nil {
		t.Fatal("incompatible environment accepted")
	}
	incompatible = after
	incompatible.Weighting = "corpus"
	if _, e = s.CompareHistory(ctx, before, incompatible); e == nil {
		t.Fatal("incompatible weighting accepted")
	}
}
func TestHistoryChangeNoMatchedContractIsUnavailable(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	first := publishCohortAt(t, s, "history-contract-before", time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "a", Workload: "fixture/shared", ContractRevision: "old", Value: 10}})
	last := publishCohortAt(t, s, "history-contract-after", time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "a", Workload: "fixture/shared", ContractRevision: "new", Value: 20}})
	before := oneHistoryScope(t, s, first)
	after := oneHistoryScope(t, s, last)
	change, e := s.CompareHistory(ctx, before, after)
	if e != nil {
		t.Fatal(e)
	}
	if change.MatchedCells != 0 || change.Ratio != nil || change.Status != "unavailable" {
		t.Fatal(change)
	}
}

func TestHistoryChangePrecisionAndPortableRebuild(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := publishCohort(t, s, "history-exact-native", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Metric: "native.code_size", ExactValue: "9007199254740993"}})
	scope := oneHistoryScope(t, s, rev)
	scope.Collectors = "allow-unrecorded-native-size"
	scope.Definitions = "allow-unregistered-native-size"
	original, e := s.CompareHistory(ctx, scope, scope)
	if e != nil {
		t.Fatal(e)
	}
	if original.ApproximateInputs != 2 || original.ReusedCells != 1 {
		t.Fatal("precision or reused evidence hidden", original)
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "test"); e != nil {
		t.Fatal(e)
	}
	r := openTest(t, rebuilt)
	defer r.Close()
	restored, e := r.CompareHistory(ctx, scope, scope)
	if e != nil {
		t.Fatal(e)
	}
	first, _ := json.Marshal(original)
	last, _ := json.Marshal(restored)
	if !bytes.Equal(first, last) {
		t.Fatal("portable rebuild changed history comparison", string(last))
	}
	scope.Revision = ""
	if _, e = s.CompareHistory(ctx, scope, scope); e == nil {
		t.Fatal("unresolved revisions accepted")
	}
}
