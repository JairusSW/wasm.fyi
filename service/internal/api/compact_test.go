package api

import (
	"bytes"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"net/http"
	"strings"
	"testing"
)

func TestCompactDatabaseHTTP(t *testing.T) {
	s, e := benchdb.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	token := strings.Repeat("x", 32)
	h, e := NewBenchmarks(s, token, DefaultRequestLimits(), nil)
	if e != nil {
		t.Fatal(e)
	}
	empty := request(t, h, "GET", "/api/platforms", nil, nil)
	if empty.Code != 200 || !bytes.Contains(empty.Body.Bytes(), []byte(`"items":[]`)) {
		t.Fatal(empty.Code, empty.Body.String())
	}
	value, rss, code := 1.0, 4096.0, 64.0
	capture := benchdb.Capture{CapturedAt: "2026-10-08T00:00:00Z", Platform: benchdb.Platform{OS: "linux", Arch: "amd64", CPU: "Fixture", Cores: 8, Kernel: "test"}, Results: []benchdb.Row{{Workload: "applications/test", Wasm: "test.wasm", Artifact: strings.Repeat("a", 64), Contract: strings.Repeat("b", 64), Engine: "wazero", Version: "1", Backend: "compiler", Phase: "steady", Status: "ok", Value: &value, PeakRSS: &rss, CodeBytes: &code, MemoryStatus: "ok", CodeStatus: "ok", CodeKind: func() *string { kind := "native-image"; return &kind }()}}}
	body, _ := json.Marshal(capture)
	readOnly := request(t, ReadOnlyBenchmarks(h), http.MethodPost, "/api/captures", body, map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"})
	if readOnly.Code != 403 || !bytes.Contains(readOnly.Body.Bytes(), []byte(`"code":"read_only"`)) {
		t.Fatal(readOnly.Code, readOnly.Body.String())
	}

	unauthorized := request(t, h, http.MethodPost, "/api/captures", body, nil)
	if unauthorized.Code != 401 {
		t.Fatal(unauthorized.Code)
	}
	posted := request(t, h, http.MethodPost, "/api/captures", body, map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"})
	if posted.Code != 200 {
		t.Fatal(posted.Code, posted.Body.String())
	}
	wrongType := request(t, h, http.MethodPost, "/api/captures", body, map[string]string{"Authorization": "Bearer " + token, "Content-Type": "text/plain"})
	if wrongType.Code != 415 {
		t.Fatal(wrongType.Code)
	}
	for _, url := range []string{"/api/benchmarks?offset=0", "/api/benchmarks?revision=old", "/api/benchmarks?cursor=invalid", "/api/benchmarks?phase=bad", "/api/benchmarks?limit=1001", "/api/benchmarks?limit=1&limit=2", "/api/benchmarks?evidence=1"} {
		res := request(t, h, "GET", url, nil, nil)
		if res.Code != 400 {
			t.Fatal(url, res.Code)
		}
	}
	catalog := request(t, h, "GET", "/api/platforms", nil, nil)
	var platforms benchdb.Catalog
	_ = json.Unmarshal(catalog.Body.Bytes(), &platforms)
	rows := request(t, h, "GET", "/api/benchmarks?phase=steady&platform="+platforms.Items[0].ID, nil, nil)
	if rows.Code != 200 || !bytes.Contains(rows.Body.Bytes(), []byte(`"peakRssBytes":4096`)) {
		t.Fatal(rows.Code, rows.Body.String())
	}
	retired := request(t, h, "GET", "/api/v1/latency", nil, nil)
	if retired.Code != 404 {
		t.Fatal(retired.Code)
	}
}

func TestCompactAssetsDoNotExhaustDatabaseReadBudget(t *testing.T) {
	s, e := benchdb.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	assets := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	h, e := NewBenchmarks(s, strings.Repeat("x", 32), DefaultRequestLimits(), assets)
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 100; i++ {
		res := request(t, h, "GET", "/assets/app.js", nil, nil)
		if res.Code != 200 {
			t.Fatal(i, res.Code)
		}
	}
	page := request(t, h, "GET", "/api/platforms", nil, nil)
	if page.Code != 200 {
		t.Fatal("static loading exhausted API budget", page.Code, page.Body.String())
	}
}
