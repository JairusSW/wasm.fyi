package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
)

func TestHistoryChangeHTTPFrozenScopeAndAdmission(t *testing.T) {
	s, e := store.Open(t.TempDir(), "test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	h, e := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if e != nil {
		t.Fatal(e)
	}
	rev := importCohort(t, s, "history-http", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}})
	before := apiCohortScope(t, s, rev)
	before.Lanes = []string{before.Baseline}
	after := before
	route := func(b, a store.CohortScope, version string) string {
		left, _ := json.Marshal(b)
		right, _ := json.Marshal(a)
		return "/api/v1/history/changes?" + url.Values{"before": {string(left)}, "after": {string(right)}, "version": {version}}.Encode()
	}
	path := route(before, after, comparison.Version)
	w := request(t, h, "GET", path, nil, nil)
	var out store.HistoryChange
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil || out.Ratio == nil || *out.Ratio != 1 || out.MatchedCells != 1 || out.ReusedCells != 1 || out.Uncertainty != "unavailable" {
		t.Fatal(w.Code, w.Body.String())
	}
	if !strings.Contains(w.Header().Get("Cache-Control"), "immutable") || w.Body.Len() > 10240 {
		t.Fatal("unbounded or mutable response")
	}
	original := w.Body.String()
	importCohort(t, s, "history-unrelated", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/two", Value: 400}})
	w = request(t, h, "GET", path, nil, nil)
	if w.Code != 200 || w.Body.String() != original {
		t.Fatal("publication changed frozen comparison", w.Code, w.Body.String())
	}
	missing := before
	missing.Revision = ""
	incompatible := after
	incompatible.Weighting = "corpus"
	for _, bad := range []string{route(missing, after, comparison.Version), route(before, incompatible, comparison.Version), route(before, after, "old"), path + "&limit=1", path + "&before={}"} {
		w = request(t, h, "GET", bad, nil, nil)
		if w.Code != 400 {
			t.Fatal("invalid comparison accepted", w.Code, bad)
		}
	}
	a := &API{Store: s, Token: strings.Repeat("x", 32), CursorKey: bytes.Repeat([]byte{1}, 32), active: make(chan struct{}, 8), calculating: make(chan struct{}, 2), limiter: newRequestLimiter(DefaultRequestLimits())}
	for i := 0; i < cap(a.calculating); i++ {
		a.calculating <- struct{}{}
	}
	w = request(t, http.HandlerFunc(a.serve), "GET", path, nil, nil)
	if w.Code != 429 {
		t.Fatal("computation admission bypassed", w.Code)
	}
	for i := 0; i < cap(a.calculating); i++ {
		<-a.calculating
	}
}
