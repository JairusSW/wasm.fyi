package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

func TestCompactHistoryAPIKeepsRowsAndSamplesOutOfGraphs(t *testing.T) {
	db, err := sqldb.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	platform := benchdb.Platform{OS: "linux", Arch: "amd64", CPU: "History API fixture", Cores: 8, Kernel: "fixture"}
	for week := 0; week < 2; week++ {
		platform.Kernel = fmt.Sprintf("kernel-%d", week)
		capture := benchdb.Capture{Platform: platform, CapturedAt: fmt.Sprintf("2026-10-%02dT00:00:00Z", week+8), Source: &benchdb.Source{Repository: "https://example.com/runtime", Revision: strings.Repeat(fmt.Sprint(week+1), 40), Ref: "main", Kind: "snapshot", AsOf: fmt.Sprintf("2026-09-%02dT10:00:00Z", 6+week*7)}}
		for i := 0; i < 40; i++ {
			value := float64((week+1)*10 + i)
			capture.Results = append(capture.Results, benchdb.Row{Engine: "wasmtime", Version: fmt.Sprint(week + 1), Backend: "cranelift", Workload: fmt.Sprintf("applications/test-%03d", i), Wasm: "fixture.wasm", Artifact: strings.Repeat("a", 64), Contract: fmt.Sprintf("%064x", i+1), Phase: "steady", Status: "ok", Value: &value, MemoryStatus: "not-measured", CodeStatus: "unsupported", TimingSamples: 5, SamplesNs: []float64{value - 2, value - 1, value, value + 1, value + 2}})
		}
		if _, err = db.Put(context.Background(), capture); err != nil {
			t.Fatal(err)
		}
	}
	catalog, err := db.Platforms(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewBenchmarks(db, strings.Repeat("t", 32), DefaultRequestLimits(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Items) != 2 {
		t.Fatal("expected both kernel environments", catalog)
	}
	query := "?platform=" + catalog.Items[0].ID + "&platforms=" + catalog.Items[0].ID + "," + catalog.Items[1].ID + "&metric=exec&engines=wasmtime"
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
	w := request("/api/history/summary"+query, "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "samplesNs") || strings.Contains(w.Body.String(), "artifactSha256") || strings.Contains(w.Body.String(), "observationId") {
		t.Fatal("graph downloaded raw measurements", w.Body.String())
	}
	var summary sqldb.HistoricalSummaryResult
	if err = json.Unmarshal(w.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if len(summary.Items) != 2 || len(summary.Workloads) != 40 || summary.Items[0].Lanes[0].Count != 40 || summary.Items[1].Lanes[0].Previous == nil {
		t.Fatal(summary)
	}
	if w.Body.Len() > 15000 {
		t.Fatal("unbounded history graph payload", w.Body.Len())
	}
	if cached := request("/api/history/summary"+query, w.Header().Get("ETag")); cached.Code != 304 || cached.Body.Len() != 0 {
		t.Fatal("history cache revalidation failed", cached.Code)
	}
	w = request("/api/history/comparison"+query+"&fromDate=2026-09-06&toDate=2026-09-13", "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var comparison sqldb.HistoricalComparisonResult
	if err = json.Unmarshal(w.Body.Bytes(), &comparison); err != nil {
		t.Fatal(err)
	}
	if comparison.Revision != summary.Revision || len(comparison.Items) != 1 || comparison.Items[0].Count != 40 {
		t.Fatal(comparison)
	}
	w = request("/api/history/report"+query+"&engine=wasmtime&fromDate=2026-09-06&toDate=2026-09-13", "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var report sqldb.HistoricalReportResult
	if err = json.Unmarshal(w.Body.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if len(report.Items) != 40 || report.Revision != summary.Revision || report.Items[0].Before != 10 || report.Items[0].After != 20 {
		t.Fatal(report)
	}
	w = request("/api/history/summary"+query+"&samples=true", "")
	if w.Code != 400 {
		t.Fatal("unknown history query accepted", w.Code)
	}
}
