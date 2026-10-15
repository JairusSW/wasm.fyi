package sqldb

import (
	"context"
	"reflect"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
)

func TestTableSnapshotPaginationAndLazyStatistics(t *testing.T) {
	ctx := context.Background()
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	capture := fixture()
	base := capture.Results[0]
	capture.Results = nil
	for _, phase := range phases {
		row := base
		row.Phase = phase
		policy := *base.Sampling
		if phase == "compile" || phase == "instantiate" {
			policy.MaxSamples = 10
		}
		row.Sampling = &policy
		capture.Results = append(capture.Results, row)
	}
	if _, err = store.Put(ctx, capture); err != nil {
		t.Fatal(err)
	}
	query := MatrixQuery{Platform: hash(capture.Platform), Corpus: "main", Limit: 2}
	first, err := store.Table(ctx, query)
	if err != nil || first.Total != 4 || first.NextOffset == nil {
		t.Fatal(first, err)
	}
	query.Offset = *first.NextOffset
	query.Revision = first.Revision
	second, err := store.Table(ctx, query)
	if err != nil || second.NextOffset != nil {
		t.Fatal(second, err)
	}
	all := append(first.Items, second.Items...)
	for i, row := range all {
		if row.Phase != phases[i] || row.Sampling != nil || row.SampleStats != nil {
			t.Fatalf("unexpected table detail %+v", row)
		}
		old, err := store.Matrix(ctx, MatrixQuery{Platform: query.Platform, Phase: row.Phase, Limit: 2})
		if err != nil {
			t.Fatal(err)
		}
		expected := old.Items[0]
		expected.Sampling = nil
		expected.SampleStats = nil
		if !reflect.DeepEqual(row, expected) {
			t.Fatal("table values differ from phase query")
		}
	}
	changed := fixture()
	changed.CapturedAt = "2026-10-09T00:00:00Z"
	changed.Results[0].Version = "2"
	if _, err = store.Put(ctx, changed); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Table(ctx, query); err != benchdb.ErrChanged {
		t.Fatalf("expected stale pagination rejection, got %v", err)
	}
}

func TestTablePhaseSelectionKeepsLastMetricsAndDeltaIsNarrow(t *testing.T) {
	ctx := context.Background()
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	capture := fixture()
	base := capture.Results[0]
	capture.Results = nil
	for _, phase := range phases {
		row := base
		row.Phase = phase
		row.Sampling = nil
		row.SamplesNs = nil
		row.TimingSamples = 0
		capture.Results = append(capture.Results, row)
	}
	if _, err = store.Put(ctx, capture); err != nil {
		t.Fatal(err)
	}
	query := MatrixQuery{Platform: hash(capture.Platform), Corpus: "main", Limit: 100, Phases: "compile,steady"}
	initial, err := store.Table(ctx, query)
	if err != nil || len(initial.Items) != 2 || initial.Items[0].Phase != "compile" || initial.Items[1].Phase != "steady" {
		t.Fatal(initial, err)
	}
	query.Phases = "instantiate"
	query.Delta = true
	delta, err := store.Table(ctx, query)
	if err != nil || len(delta.Items) != 1 || delta.Items[0].Phase != "instantiate" {
		t.Fatal(delta, err)
	}
	query.Phases = "instantiate"
	query.Delta = false
	complete, err := store.Table(ctx, query)
	if err != nil || len(complete.Items) != 2 || complete.Items[1].Phase != "steady" {
		t.Fatal("last phase lost", complete, err)
	}
}
func TestFeatureSnapshotsCannotReplaceApplicationMeasurements(t *testing.T) {
	ctx := context.Background()
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	main := fixture()
	if _, err = store.Put(ctx, main); err != nil {
		t.Fatal(err)
	}
	newer := fixture()
	source := *newer.Source
	source.AsOf = "2026-10-07T00:00:00Z"
	source.Revision = "2222222222222222222222222222222222222222"
	newer.Source = &source
	newer.Results[0].Workload = "features/test/case"
	newer.Results[0].Contract = "3333333333333333333333333333333333333333333333333333333333333333"
	if _, err = store.Put(ctx, newer); err != nil {
		t.Fatal(err)
	}
	result, err := store.Aggregate(ctx, AggregateQuery{Platform: hash(main.Platform), Metric: "steady", Cohort: "per-engine", Average: "mean"})
	if err != nil || len(result.Cards) != 1 || result.Cards[0].Value == nil || *result.Cards[0].Value != 10 {
		t.Fatal("feature version shadowed applications", result, err)
	}
}

func TestActiveTableVersionsPreservePinnedFailuresAndSeparateCorpora(t *testing.T) {
	base := fixture()
	old := Cell{ObservationID: 1, Result: benchdb.Result{Row: base.Results[0], CapturedAt: base.CapturedAt}}
	old.Source = base.Source
	newerSource := *base.Source
	newerSource.AsOf = "2026-10-07T00:00:00Z"
	failed := old
	failed.ObservationID = 2
	failed.Source = &newerSource
	failed.Status = "failed"
	failed.Version = "fallback"
	failed.Value = nil
	passed := failed
	passed.ObservationID = 3
	passed.Workload = "applications/second"
	passed.Status = "ok"
	passed.Version = "2"
	feature := old
	feature.ObservationID = 4
	feature.Workload = "features/test/probe"
	selected := activeTableCells([]Cell{old, failed, passed, feature})
	if len(selected) != 3 || selected[0].ObservationID != 2 || selected[1].ObservationID != 3 || selected[2].ObservationID != 4 {
		t.Fatal("mixed pinned versions or corpora", selected)
	}
	legacy := old
	legacy.Engine = "v8"
	legacy.Backend = "optimizing-only"
	corrected := legacy
	corrected.ObservationID = 5
	corrected.Backend = "turboshaft"
	unknown := legacy
	unknown.ObservationID = 6
	unknown.Phase = "compile"
	unknown.Backend = "unavailable"
	unknown.Status = "failed"
	selected = activeTableCells([]Cell{legacy, corrected, unknown})
	if len(selected) != 2 || selected[0].ObservationID != 5 || selected[1].ObservationID != 6 {
		t.Fatal("V8 correction/failure identity lost", selected)
	}
}
