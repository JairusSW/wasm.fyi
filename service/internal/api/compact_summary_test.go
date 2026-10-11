package api

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
)

func TestCompactSummaryIsSmallSampleFreeAndConditional(t *testing.T) {
	s, err := benchdb.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	v := 1.0
	capture := benchdb.Capture{CapturedAt: "2026-10-10T17:00:00Z", Platform: benchdb.Platform{OS: "linux", Arch: "amd64", CPU: "Fixture", Cores: 8, Kernel: "test"}, Results: []benchdb.Row{{Workload: "applications/test", Wasm: "test.wasm", Artifact: strings.Repeat("a", 64), Contract: strings.Repeat("b", 64), Engine: "wazero", Version: "1", Backend: "compiler", Phase: "steady", Status: "ok", Value: &v, MemoryStatus: "not-measured", CodeStatus: "not-measured", SamplesNs: []float64{1, 2, 3, 4, 5}, TimingSamples: 5}}}
	if _, err = s.Put(context.Background(), capture); err != nil {
		t.Fatal(err)
	}
	h, err := NewBenchmarks(s, strings.Repeat("x", 32), DefaultRequestLimits(), nil)
	if err != nil {
		t.Fatal(err)
	}
	first := request(t, h, "GET", "/api/summary", nil, nil)
	if first.Code != http.StatusOK || first.Body.Len() > 2000 || bytes.Contains(first.Body.Bytes(), []byte("samplesNs")) {
		t.Fatal(first.Code, first.Body.String())
	}
	second := request(t, h, "GET", "/api/summary", nil, map[string]string{"If-None-Match": first.Header().Get("ETag")})
	if second.Code != http.StatusNotModified || second.Body.Len() != 0 {
		t.Fatal("unchanged summary retransferred", second.Code)
	}
	invalid := request(t, h, "GET", "/api/summary?history=all", nil, nil)
	if invalid.Code != http.StatusBadRequest {
		t.Fatal("accepted dump query", invalid.Code)
	}
}
