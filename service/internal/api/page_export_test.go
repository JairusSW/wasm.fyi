package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestPreparedPagePreservesAPIComparisonsWithoutEvidence(t *testing.T) {
	s, err := store.Open(filepath.Join(t.TempDir(), "data"), "page-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	cells := []testutil.CohortCell{}
	for _, runtime := range []string{"wasmtime", "wago"} {
		for _, scenario := range []string{"compile", "instantiate", "first-call", "steady"} {
			value := 10.0
			if runtime == "wago" {
				value = 20
			}
			cells = append(cells, testutil.CohortCell{Runtime: runtime, Version: "1", Workload: "app/a", Group: "applications", Scenario: scenario, Value: value})
		}
	}
	revision := importCohort(t, s, "page-default", cells)
	key := []byte(strings.Repeat("k", 32))
	b := NewPageBuilder(s, key)
	catalogs := map[string][]wire.Record{}
	for _, kind := range []string{"environment", "track", "workload"} {
		catalogs[kind+"s"], err = b.DisplayCatalog(context.Background(), kind)
		if err != nil {
			t.Fatal(err)
		}
	}
	seed, err := b.DefaultPage(context.Background(), "m1", catalogs["environments"][0].ID, nil, catalogs, true)
	if err != nil {
		t.Fatal(err)
	}
	if seed.Revision != revision || len(seed.Overviews) != 4 || len(seed.Matrix) == 0 {
		t.Fatalf("incomplete default page: %+v", seed)
	}
	h, err := New(s, strings.Repeat("t", 32), key)
	if err != nil {
		t.Fatal(err)
	}
	for metric, raw := range seed.Overviews {
		var overview store.OverviewResponse
		if err = json.Unmarshal(raw, &overview); err != nil {
			t.Fatal(err)
		}
		scope, _ := json.Marshal(overview.Scope)
		p := url.Values{"scope": {string(scope)}, "version": {"wasmfyi-cohort-v4"}}
		r := httptest.NewRequest("GET", "/api/v1/overview?"+p.Encode(), nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || strings.TrimSpace(w.Body.String()) != string(raw) {
			t.Fatalf("%s diverges from API: %d %s", metric, w.Code, w.Body.String())
		}
	}
	prepared, e := b.PreparedResults(context.Background(), seed)
	if e != nil {
		t.Fatal(e)
	}
	directory := t.TempDir()
	path := filepath.Join(directory, "prepared-results.json")
	if e = os.WriteFile(path, prepared, 0600); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(path+".sha256", []byte(wire.Hash(prepared)), 0600); e != nil {
		t.Fatal(e)
	}
	if e = s.PrepareHistoryReadIndex(t.Context(), filepath.Join(directory, "history-index"), nil); e != nil {
		t.Fatal(e)
	}
	populationIndex := filepath.Join(directory, "history-index")
	if e = b.PrepareHistoryReferences(t.Context(), populationIndex, catalogs["environments"], nil); e != nil {
		t.Fatal(e)
	}
	beforeCohorts := map[string][]byte{}
	for metric, raw := range seed.Overviews {
		var overview store.OverviewResponse
		_ = json.Unmarshal(raw, &overview)
		cohort, err := s.ComputeCohort(t.Context(), overview.Scope)
		if err != nil {
			t.Fatal(err)
		}
		beforeCohorts[metric], _ = wire.Encode(cohort)
	}
	cached, e := NewWithPreparedPageData(s, strings.Repeat("t", 32), key, DefaultRequestLimits(), nil, directory)
	if e != nil {
		t.Fatal(e)
	}
	if cached.(*API).historyIndex == nil || cached.(*API).historyIndex.Revision != revision {
		t.Fatal("prepared API did not open matching history index")
	}
	t.Cleanup(func() {
		if e := cached.(*API).Close(); e != nil {
			t.Error(e)
		}
	})
	for metric, raw := range seed.Overviews {
		var overview store.OverviewResponse
		_ = json.Unmarshal(raw, &overview)
		cohort, err := s.ComputeCohort(t.Context(), overview.Scope)
		if err != nil {
			t.Fatal(err)
		}
		indexed, _ := wire.Encode(cohort)
		if string(indexed) != string(beforeCohorts[metric]) {
			t.Fatal("prepared scientific population changed cohort", metric)
		}
	}
	laneIDs := []string{}
	for _, record := range catalogs["tracks"] {
		laneIDs = append(laneIDs, record.ID)
	}
	encoded, _ := json.Marshal(laneIDs)
	p := url.Values{"revision": {revision}, "environment": {seed.Environment}, "selection": {"current"}, "tracks": {string(encoded)}, "metric": {"time.wall"}, "scenario": {"steady"}, "profile": {"timing"}, "statistic": {"median_ns_per_operation"}, "limit": {"25"}}
	w := httptest.NewRecorder()
	cached.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/matrix?"+p.Encode(), nil))
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != string(seed.Matrix) {
		t.Fatal("prepared selection changed complete table", w.Code, w.Body.String())
	}
	before, e := s.Stats()
	if e != nil {
		t.Fatal(e)
	}
	p.Del("selection")
	p.Del("limit")
	p.Set("from", "2024-10-01")
	p.Set("until", "2026-10-08")
	p.Set("weighting", "corpus")
	w = httptest.NewRecorder()
	cached.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/history/timeline?"+p.Encode(), nil))
	if w.Code != 200 {
		t.Fatal("prepared history failed", w.Code, w.Body.String())
	}
	after, e := s.Stats()
	if e != nil {
		t.Fatal(e)
	}
	for i := range before.ResultQueries {
		if before.ResultQueries[i].Queries != after.ResultQueries[i].Queries {
			t.Fatal("history reloaded prepared current reference or scanned source history")
		}
	}
	if e = os.WriteFile(path, append(prepared, ' '), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = NewWithPreparedPageData(s, strings.Repeat("t", 32), key, DefaultRequestLimits(), nil, directory); e == nil {
		t.Fatal("corrupt prepared page cache accepted")
	}
	var matrix struct{ Items []matrixRow }
	if err = json.Unmarshal(seed.Matrix, &matrix); err != nil {
		t.Fatal(err)
	}
	if len(matrix.Items) != 1 || len(matrix.Items[0].Results) != 2 {
		t.Fatal("default table scope lost cells")
	}
	for _, r := range matrix.Items[0].Results {
		var v wire.Result
		_ = json.Unmarshal(r.Data, &v)
		if v.ReportID == "" || v.ContractID == "" {
			t.Fatal("cell provenance missing")
		}
	}
	raw, _ := json.Marshal(seed)
	for _, forbidden := range []string{"\"trials\"", "\"samples\"", "\"history\"", "\"machineInfo\""} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("embedded bulk resource %s", forbidden)
		}
	}
}
