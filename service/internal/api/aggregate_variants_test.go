package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

func TestBatchedAverageVariants(t *testing.T) {
	db, err := sqldb.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	capture := benchdb.Capture{CapturedAt: "2026-10-09T00:00:00Z", Platform: benchdb.Platform{OS: "linux", Arch: "amd64", CPU: "Fixture", Cores: 4, Kernel: "test"}}
	for i, value := range []float64{100, 400} {
		capture.Results = append(capture.Results, benchdb.Row{Workload: []string{"applications/one", "applications/two"}[i], Wasm: "test.wasm", Artifact: strings.Repeat("a", 64), Contract: strings.Repeat("b", 63) + []string{"1", "2"}[i], Engine: "wasmtime", Version: "1", Backend: "cranelift", Phase: "steady", Status: "ok", Value: &value, MemoryStatus: "not-measured", CodeStatus: "not-measured"})
	}
	if _, err = db.Put(context.Background(), capture); err != nil {
		t.Fatal(err)
	}
	summary, err := db.Summary(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewBenchmarks(db, strings.Repeat("x", 32), DefaultRequestLimits(), nil)
	if err != nil {
		t.Fatal(err)
	}
	response := request(t, handler, "GET", "/api/aggregates?platform="+summary.Platforms[0].ID+"&metrics=steady&average=both&cohort=per-engine&weighting=workload", nil, nil)
	var result struct {
		Items []struct {
			Average string
			Cards   []sqldb.AggregateCard
		}
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Items) != 2 {
		t.Fatal(response.Code, response.Body.String())
	}
	for i, expected := range []float64{200, 250} {
		item := result.Items[i]
		if len(item.Cards) != 1 || item.Cards[0].Value == nil || *item.Cards[0].Value < expected-0.0001 || *item.Cards[0].Value > expected+0.0001 || item.Average != []string{"geo", "mean"}[i] {
			t.Fatalf("incorrect average %+v", item)
		}
	}
}

// Averages accept every environment of one host and fill cells its newest
// environment has not measured yet.
func TestAggregatesMergeHostEnvironments(t *testing.T) {
	db, err := sqldb.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	put := func(kernel, captured, workload string, value float64) {
		capture := benchdb.Capture{CapturedAt: captured, Platform: benchdb.Platform{OS: "linux", Arch: "amd64", CPU: "Fixture", Cores: 4, Kernel: kernel}}
		capture.Results = []benchdb.Row{{Workload: workload, Wasm: "test.wasm", Artifact: strings.Repeat("a", 64), Contract: strings.Repeat("b", 63) + map[string]string{"applications/one": "1", "applications/two": "2"}[workload], Engine: "wasmtime", Version: "1", Backend: "cranelift", Phase: "steady", Status: "ok", Value: &value, MemoryStatus: "not-measured", CodeStatus: "not-measured"}}
		if _, err := db.Put(context.Background(), capture); err != nil {
			t.Fatal(err)
		}
	}
	put("old", "2026-10-01T00:00:00Z", "applications/one", 100)
	put("old", "2026-10-01T00:00:00Z", "applications/two", 400)
	put("new", "2026-10-09T00:00:00Z", "applications/one", 100)
	summary, err := db.Summary(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	for _, p := range summary.Platforms {
		ids[p.Kernel] = p.ID
	}
	handler, err := NewBenchmarks(db, strings.Repeat("x", 32), DefaultRequestLimits(), nil)
	if err != nil {
		t.Fatal(err)
	}
	response := request(t, handler, "GET", "/api/aggregates?platform="+ids["new"]+"&platforms="+ids["new"]+","+ids["old"]+"&metric=steady&average=mean&cohort=per-engine", nil, nil)
	var result sqldb.AggregateResult
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Cards) != 1 || result.Cards[0].Count != 2 || len(result.Workloads) != 2 {
		t.Fatal(response.Code, response.Body.String())
	}
}
