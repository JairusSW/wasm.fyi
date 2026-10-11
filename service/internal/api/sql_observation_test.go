package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

func TestObservationWithoutAsOfResolvesCurrentAndHistoricalSamples(t *testing.T) {
	db, err := sqldb.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	platform := benchdb.Platform{OS: "linux", Arch: "amd64", CPU: "Observation fixture", Cores: 2, Kernel: "fixture"}
	value := 12.0
	samples := []float64{10, 11, 12, 13, 14}
	capture := benchdb.Capture{Platform: platform, CapturedAt: "2026-10-10T00:00:00Z", Source: &benchdb.Source{Repository: "https://example.com/runtime", Revision: strings.Repeat("a", 40), Ref: "main", Kind: "snapshot", AsOf: "2026-10-09T00:00:00Z"}, Results: []benchdb.Row{{Engine: "wasmtime", Version: "fixture", Backend: "cranelift", Workload: "applications/fixture", Wasm: "fixture.wasm", Artifact: strings.Repeat("b", 64), Contract: strings.Repeat("c", 64), Phase: "steady", Status: "ok", Value: &value, MemoryStatus: "not-measured", CodeStatus: "unsupported", TimingSamples: 5, SamplesNs: samples}}}
	if _, err = db.Put(ctx, capture); err != nil {
		t.Fatal(err)
	}
	catalog, err := db.Platforms(ctx)
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewBenchmarks(db, strings.Repeat("t", 32), DefaultRequestLimits(), nil)
	if err != nil {
		t.Fatal(err)
	}
	request := func(path, etag string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", path, nil)
		r.RemoteAddr = "127.0.0.1:1234"
		if etag != "" {
			r.Header.Set("If-None-Match", etag)
		}
		handler.ServeHTTP(w, r)
		return w
	}
	for _, query := range []string{
		"?platform=" + catalog.Items[0].ID + "&id=999999999",
		"?platform=" + strings.Repeat("0", 64) + "&id=1",
	} {
		missing := request("/api/observation"+query, "")
		if missing.Code != 404 || !strings.Contains(missing.Body.String(), `"error"`) {
			t.Fatal("unknown observation/platform must remain a structured 404", missing.Code, missing.Body.String())
		}
	}
	for _, route := range []string{"/api/matrix", "/api/timeline"} {
		matrix := request(route+"?platform="+catalog.Items[0].ID+"&phase=steady&limit=1", "")
		var page struct {
			Rows [][]json.RawMessage `json:"rows"`
		}
		if matrix.Code != 200 || json.Unmarshal(matrix.Body.Bytes(), &page) != nil || len(page.Rows) != 1 {
			t.Fatal(route, matrix.Code, matrix.Body.String())
		}
		var id int64
		if err = json.Unmarshal(page.Rows[0][0], &id); err != nil {
			t.Fatal(err)
		}
		path := fmt.Sprintf("/api/observation?platform=%s&id=%d", catalog.Items[0].ID, id)
		for _, suffix := range []string{"", "&asOf=", "&asOf=" + url.QueryEscape(capture.Source.AsOf)} {
			response := request(path+suffix, "")
			var detail benchdb.Result
			if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &detail) != nil || !reflect.DeepEqual(detail.SamplesNs, samples) {
				t.Fatal(route, suffix, response.Code, response.Body.String())
			}
			etag := response.Header().Get("ETag")
			if etag == "" {
				t.Fatal("missing ETag")
			}
			cached := request(path+suffix, etag)
			if cached.Code != 304 || cached.Body.Len() != 0 {
				t.Fatal("observation cache failed", cached.Code)
			}
		}
		missing := request(path+"&asOf=2026-01-01T00:00:00Z", "")
		if missing.Code != 404 {
			t.Fatal("unknown alias should not silently return another observation", missing.Code)
		}
	}
}
