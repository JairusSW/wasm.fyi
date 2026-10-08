package store

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"testing"
	"time"
)

func TestQueryNodeCacheDecodesOnceAndReturnsIndependentMaps(t *testing.T) {
	cache := &queryNodeCache{}
	reads := 0
	fetch := func() ([]byte, error) { reads++; return []byte(`{"entries":{"a":"b"}}`), nil }
	one, err := cache.read("node", fetch)
	if err != nil {
		t.Fatal(err)
	}
	one.Entries["a"] = "changed"
	two, err := cache.read("node", fetch)
	if err != nil || reads != 1 || two.Entries["a"] != "b" {
		t.Fatalf("reads=%d value=%v err=%v", reads, two, err)
	}
}

func TestCohortSelectsCommonContextOnceForDistinctMethods(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	job, objects, err := testutil.CohortFixture("distinct-methods", time.Now(), []testutil.CohortCell{{Runtime: "a", Workload: "app/a", Group: "applications", Value: 100}, {Runtime: "b", Workload: "app/a", Group: "applications", Value: 200}})
	if err != nil {
		t.Fatal(err)
	}
	manifest := &job.Exports[0].Manifest
	for i, o := range manifest.Objects {
		body := objects[o.SHA256]
		var r wire.Record
		if o.Kind == "record" && wire.Decode(body, &r) == nil && r.Kind == "result" {
			var v wire.Result
			_ = wire.Decode(r.Data, &v)
			if v.Runtime == "b" {
				var recipe map[string]any
				_ = json.Unmarshal(v.MeasurementMethod.Recipe, &recipe)
				recipe["fixtureVariant"] = "b"
				v.MeasurementMethod.Recipe, _ = wire.Encode(recipe)
				v.MeasurementMethod.RecipeSHA256 = wire.Hash(v.MeasurementMethod.Recipe)
				v.MeasurementMethodID = v.MeasurementMethod.ID()
				r.Data, _ = wire.Encode(v)
				r.ID = wire.Hash(r.Data)
				body, _ = wire.Encode(r)
			}
		}
		o.SHA256 = wire.Hash(body)
		o.Bytes = len(body)
		manifest.Objects[i] = o
		objects[o.SHA256] = body
	}
	raw, _ := wire.Encode(*manifest)
	job.Exports[0].SHA256 = wire.Hash(raw)
	for _, o := range manifest.Objects {
		if err = s.Install(o.SHA256, bytes.NewReader(objects[o.SHA256])); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	scope := cohortScope(t, s, revision)
	scope.MethodPolicy = "explicit-source-membership-v1"
	scope.Selectors = nil
	rows, err := s.Results(Query{Revision: revision}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		var v wire.Result
		_ = wire.Decode(r.Data, &v)
		scope.Selectors = append(scope.Selectors, CohortSelector{v.MetricDefinitionID, v.MeasurementMethodID, v.AnalysisVersion})
	}
	before := s.resultQueryStats()[0].Queries
	cohort, err := s.ComputeCohort(context.Background(), scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(cohort.Comparison.Populations) != 2 {
		t.Fatal("distinct method populations were combined incorrectly")
	}
	if queries := s.resultQueryStats()[0].Queries - before; queries != 1 {
		t.Fatalf("shared context selected %d times", queries)
	}
}

func TestCohortSharesVerifiedIndexReadsAcrossMembershipAndMetadata(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	cells := []testutil.CohortCell{}
	for _, runtime := range []string{"a", "b"} {
		for _, name := range []string{"one", "two", "three"} {
			cells = append(cells, testutil.CohortCell{Runtime: runtime, Workload: "fixture/" + name, Group: "x", Value: 100})
		}
	}
	revision := publishCohort(t, s, "cohort-read-cache", cells)
	scope := cohortScope(t, s, revision)
	reader := s.validationStore()
	counts := map[string]int{}
	reader.validationReader = func(ctx context.Context, id string, ceiling int) ([]byte, error) {
		body, err := s.representationContext(ctx, id, ceiling)
		var n node
		if err == nil && json.Unmarshal(body, &n) == nil && (n.Entries != nil || n.Children != nil) {
			counts[id]++
		}
		return body, err
	}
	cohort, err := reader.ComputeCohort(context.Background(), scope)
	if err != nil || len(cohort.Comparison.Populations) != 2 {
		t.Fatalf("populations=%d err=%v", len(cohort.Comparison.Populations), err)
	}
	for id, count := range counts {
		if count != 1 {
			t.Fatalf("shared cohort index %s fetched %d times", id, count)
		}
	}
}

func TestResultsReuseSharedIndexReadsWithinQuery(t *testing.T) {
	s, err := Open(t.TempDir(), "query-cache")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.EnableOfflineImport()
	cells := []testutil.CohortCell{}
	for _, name := range []string{"one", "two", "three", "four", "five"} {
		cells = append(cells, testutil.CohortCell{Runtime: "a", Workload: "fixture/" + name, Group: "x", Value: 100})
	}
	job, objects, err := testutil.CohortFixture("shared-read", time.Now(), cells)
	if err != nil {
		t.Fatal(err)
	}
	for id, body := range objects {
		if err = s.Install(id, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Commit(id); err != nil {
		t.Fatal(err)
	}
	reader := s.validationStore()
	counts := map[string]int{}
	reader.validationReader = func(ctx context.Context, id string, ceiling int) ([]byte, error) {
		b, err := s.representationContext(ctx, id, ceiling)
		var n node
		if err == nil && json.Unmarshal(b, &n) == nil && (n.Entries != nil || n.Children != nil) {
			counts[id]++
		}
		return b, err
	}
	rows, err := reader.ResultsContext(context.Background(), Query{Selection: "current"}, false)
	if err != nil || len(rows) != 5 {
		t.Fatalf("rows=%d err=%v", len(rows), err)
	}
	for id, count := range counts {
		if count != 1 {
			t.Fatalf("shared index %s fetched %d times in one query", id, count)
		}
	}
	// A fresh query must fetch and verify again rather than retaining stale bytes.
	for id := range counts {
		counts[id] = 0
	}
	if _, err = reader.ResultsContext(context.Background(), Query{Selection: "current"}, false); err != nil {
		t.Fatal(err)
	}
	for id, count := range counts {
		if count != 1 {
			t.Fatalf("next query index %s fetched %d times", id, count)
		}
	}
}
