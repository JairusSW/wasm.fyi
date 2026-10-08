package api

import (
	"bytes"
	"context"
	"encoding/json"
	"strconv"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestPageTimingSampleCountUsesRecordedCurrentTimingSamples(t *testing.T) {
	s, e := store.Open(t.TempDir(), "statistics-test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	cells := []testutil.CohortCell{}
	for _, runtime := range []string{"a", "b"} {
		for _, scenario := range []string{"compile", "instantiate", "first-call", "steady"} {
			cells = append(cells, testutil.CohortCell{Runtime: runtime, Workload: "app/a", Scenario: scenario, Value: 100})
		}
	}
	cells = append(cells, testutil.CohortCell{Runtime: "a", Workload: "app/a", Scenario: "steady", SourceProfile: "memory", Value: 100})
	for index, count := range []int{100, 6} {
		job, objects, e := testutil.CohortFixture(strconv.Itoa(count), time.Date(2026, 10, 5+index, 0, 0, 0, 0, time.UTC), cells)
		if e != nil {
			t.Fatal(e)
		}
		// Publish the larger count first, then a newer timing collection.
		manifest := &job.Exports[0].Manifest
		for i, object := range manifest.Objects {
			body := objects[object.SHA256]
			var r wire.Record
			if object.Kind == "record" && json.Unmarshal(body, &r) == nil && r.Kind == "result" {
				var result wire.Result
				_ = json.Unmarshal(r.Data, &result)
				var summary map[string]any
				_ = json.Unmarshal(result.Summary, &summary)
				n := count
				if count == 6 && result.Runtime == "b" && result.Scenario == "first-call" {
					n = 0
				}
				summary["recorded_samples"] = n
				result.Summary, _ = wire.Encode(summary)
				r.Data, _ = wire.Encode(result)
				r.ID = wire.Hash(r.Data)
				body, _ = wire.Encode(r)
			}
			object.SHA256 = wire.Hash(body)
			object.Bytes = len(body)
			manifest.Objects[i] = object
			objects[object.SHA256] = body
		}
		raw, _ := wire.Encode(*manifest)
		job.Exports[0].SHA256 = wire.Hash(raw)
		for _, o := range manifest.Objects {
			if e = s.Install(o.SHA256, bytes.NewReader(objects[o.SHA256])); e != nil {
				t.Fatal(e)
			}
		}
		id, e := s.Submit(job)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = s.Commit(id); e != nil {
			t.Fatal(e)
		}
	}
	b := NewPageBuilder(s, bytes.Repeat([]byte{1}, 32))
	environments, e := b.DisplayCatalog(context.Background(), "environment")
	if e != nil {
		t.Fatal(e)
	}
	stats, e := b.Statistics(context.Background(), environments)
	if e != nil {
		t.Fatal(e)
	}
	if stats.TimingSamples == nil || *stats.TimingSamples != 42 {
		t.Fatalf("expected 42 current timing samples, got %+v", stats)
	}
	importCohort(t, s, "count-unknown", []testutil.CohortCell{{Runtime: "a", Workload: "app/new", Value: 10}})
	b = NewPageBuilder(s, bytes.Repeat([]byte{1}, 32))
	stats, e = b.Statistics(context.Background(), environments)
	if e != nil || stats.TimingSamples != nil {
		t.Fatal("missing counts were invented", stats, e)
	}
}
