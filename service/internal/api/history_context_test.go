package api

import (
	"bytes"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestHistoryContextHTTPPublicationAndCursor(t *testing.T) {
	s, e := store.Open(t.TempDir(), "test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	h, e := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if e != nil {
		t.Fatal(e)
	}
	job, objects, e := testutil.CohortFixture("history-http-context", time.Now().UTC(), []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}, {Runtime: "b", Workload: "fixture/one", Value: 8}})
	if e != nil {
		t.Fatal(e)
	}
	configurations := map[string]bool{}
	for id, body := range objects {
		if e = s.Install(id, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
		var r wire.Record
		_ = json.Unmarshal(body, &r)
		if r.Kind == "configuration" {
			configurations[r.ID] = true
		}
	}
	for id := range configurations {
		job.History = append(job.History, wire.HistoryBinding{ReportID: job.Exports[0].Manifest.ReportID, ConfigurationID: id, Policy: wire.HistoryBindingPolicy, TargetDates: []string{"2026-01-03", "2026-01-10"}, BuildRole: "source"})
	}
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	route := "/api/v1/history/jobs/" + id
	// A staged job is absent from a known earlier dataset revision.
	prior := importFixture(t, s, "prior-history-context", time.Now().UTC())
	w := request(t, h, "GET", route+"?revision="+prior, nil, nil)
	if w.Code != 404 {
		t.Fatal("unpublished interpretation exposed", w.Code, w.Body.String())
	}
	rev, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	path := route + "?revision=" + rev + "&limit=1"
	w = request(t, h, "GET", path, nil, nil)
	var page struct {
		Items      []store.HistoryContext
		Total      int
		NextCursor string
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 1 || page.Total != len(job.History) || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Fatal(w.Code, w.Body.String())
	}
	before := w.Body.String()
	if len(page.Items[0].Binding.TargetDates) != 2 || page.Items[0].Binding.TargetDate != "" {
		t.Fatal("HTTP lost target aliases")
	}
	importFixture(t, s, "later-history-context", time.Now().UTC())
	w = request(t, h, "GET", path, nil, nil)
	if w.Code != 200 || w.Body.String() != before {
		t.Fatal("history context changed with publication")
	}
	if page.NextCursor == "" {
		t.Fatal("missing cursor for two configuration bindings")
	}
	if page.NextCursor != "" {
		w = request(t, h, "GET", route+"?limit=1&cursor="+url.QueryEscape(page.NextCursor), nil, nil)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		w = request(t, h, "GET", route+"?limit=2&cursor="+url.QueryEscape(page.NextCursor), nil, nil)
		if w.Code != 400 {
			t.Fatal("cursor page size mutation accepted")
		}
	}
	for _, bad := range []string{route + "?limit=101", route + "?from=2026-01-01", route + "?configuration=" + strings.Repeat("a", 64)} {
		w = request(t, h, "GET", bad, nil, nil)
		if w.Code != 400 {
			t.Fatal("invalid history context query accepted", bad, w.Code)
		}
	}
}
