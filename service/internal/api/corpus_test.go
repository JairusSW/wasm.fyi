package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestCorpusAndInspectionAreBoundedSummaryReads(t *testing.T) {
	s, e := store.Open(t.TempDir(), "corpus-test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	revision := importCohort(t, s, "corpus", []testutil.CohortCell{{Runtime: "wasmtime", Version: "1", Workload: "app/a", Group: "applications", Value: 100}, {Runtime: "wasmtime", Version: "1", Workload: "app/a", Group: "applications", Metric: "native.code_size", Value: 123}, {Runtime: "wasmtime", Version: "1", Workload: "app/b", Group: "applications", Value: 200}})
	rows, e := s.ResultsContext(context.Background(), store.Query{Revision: revision, Workload: "app/a"}, false)
	if e != nil {
		t.Fatal(e)
	}
	var v wire.Result
	_ = wire.Decode(rows[0].Data, &v)
	tracks, _ := json.Marshal([]string{v.TrackID})
	p := url.Values{"revision": {revision}, "environment": {v.EnvironmentID}, "selection": {"current"}, "tracks": {string(tracks)}}
	h, e := New(s, strings.Repeat("t", 32), []byte(strings.Repeat("k", 32)))
	if e != nil {
		t.Fatal(e)
	}
	corpus := request(t, h, http.MethodGet, "/api/v1/corpus/"+v.ContractID+"?"+p.Encode(), nil, nil)
	if corpus.Code != 200 {
		t.Fatal(corpus.Body.String())
	}
	var detail struct {
		Results     []wire.Record
		Eligibility map[string]matrixEligibility
	}
	if e = json.Unmarshal(corpus.Body.Bytes(), &detail); e != nil || len(detail.Results) != 2 || len(detail.Eligibility) != 2 {
		t.Fatal("corpus lost exact summary or eligibility", e, corpus.Body.String())
	}
	for _, r := range detail.Results {
		var selected wire.Result
		_ = wire.Decode(r.Data, &selected)
		if selected.Workload != "app/a" || selected.ContractID != v.ContractID || len(selected.Evidence) > 0 || selected.MeasurementMethod != nil {
			t.Fatal("corpus scope/evidence leak")
		}
	}
	inspect := request(t, h, http.MethodGet, "/api/v1/inspect/"+v.ContractID+"?"+p.Encode(), nil, nil)
	if inspect.Code != 200 {
		t.Fatal(inspect.Body.String())
	}
	var inspection struct {
		Items []struct {
			Measurement         wire.Record
			Content, Inspection string
			Artifact            *wire.Record
			Bytes, Functions    string
		}
	}
	if e = json.Unmarshal(inspect.Body.Bytes(), &inspection); e != nil || len(inspection.Items) != 1 {
		t.Fatal("inspection lost size-only measurement", e, inspect.Body.String())
	}
	item := inspection.Items[0]
	var size wire.Result
	_ = wire.Decode(item.Measurement.Data, &size)
	var summary struct {
		Bytes float64 `json:"size_bytes"`
	}
	_ = json.Unmarshal(size.Summary, &summary)
	if summary.Bytes != 123 || item.Artifact != nil || item.Content != "unavailable" || item.Inspection != "unavailable" || item.Bytes != "" || item.Functions != "" {
		t.Fatal("inspection invented content or lost measured size", inspect.Body.String())
	}
	p.Set("tracks", "[]")
	bad := request(t, h, http.MethodGet, "/api/v1/corpus/"+v.ContractID+"?"+p.Encode(), nil, nil)
	if bad.Code != 400 {
		t.Fatal("unbounded corpus scope accepted")
	}
}
