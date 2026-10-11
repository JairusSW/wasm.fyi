package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/frontend"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

func TestCompactFrontendUsesPublishedWorkloadsAndPreservesAPI(t *testing.T) {
	for _, backend := range []string{"sqlite", "pebble"} {
		t.Run(backend, func(t *testing.T) {
			var db BenchmarkStore
			if backend == "sqlite" {
				s, err := sqldb.Open(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				defer s.Close()
				db = s
			} else {
				s, err := benchdb.Open(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				defer s.Close()
				db = s
			}
			dir := t.TempDir()
			for name, body := range map[string]string{
				"404.html":            "<html><body>application shell</body></html>",
				"index.html":          "<html><title>WebAssembly runtimes</title><h1>WebAssembly runtimes</h1></html>",
				"docs/index.html":     "<html><title>Data access</title><h1>API documentation</h1></html>",
				"history/__data.json": `{"type":"data","nodes":[{"type":"data","data":[{"pageSeed":1},null],"uses":{"route":1}},null]}`,
			} {
				p := filepath.Join(dir, name)
				if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(p, []byte(body), 0644); err != nil {
					t.Fatal(err)
				}
			}
			static, err := frontend.Open(dir, db.HasWorkload)
			if err != nil {
				t.Fatal(err)
			}
			defer static.Close()
			h, err := NewBenchmarks(db, strings.Repeat("x", 32), DefaultRequestLimits(), static)
			if err != nil {
				t.Fatal(err)
			}
			for _, route := range []string{"/bench/applications/new/", "/bench/applications/new/__data.json"} {
				if w := request(t, h, "GET", route, nil, nil); w.Code != 404 || w.Header().Get("X-Robots-Tag") != "noindex" {
					t.Fatal("unpublished route", route, w.Code)
				}
			}
			value := 12.0
			capture := benchdb.Capture{CapturedAt: "2026-10-08T00:00:00Z", Platform: benchdb.Platform{OS: "linux", Arch: "amd64", CPU: "Fixture", Cores: 8, Kernel: "test"}, Results: []benchdb.Row{{Workload: "applications/new", Wasm: "new.wasm", Artifact: strings.Repeat("a", 64), Contract: strings.Repeat("b", 64), Engine: "wazero", Version: "1", Backend: "compiler", Phase: "steady", Status: "ok", Value: &value, MemoryStatus: "not-measured", CodeStatus: "not-measured"}}}
			if _, err = db.Put(t.Context(), capture); err != nil {
				t.Fatal(err)
			}
			for _, route := range []string{"/bench/applications/new/", "/bench/applications/new/__data.json"} {
				if w := request(t, h, "GET", route, nil, nil); w.Code != 200 {
					t.Fatal("new publication needs no frontend rebuild", route, w.Code, w.Body.String())
				}
			}
			for _, route := range []string{"/bench/applications/new-child/", "/bench/applications/", "/unknown/"} {
				if w := request(t, h, "GET", route, nil, nil); w.Code != 404 {
					t.Fatal("unknown route", route, w.Code)
				}
			}
			if w := request(t, h, "GET", "/docs/", nil, nil); w.Code != 200 || !strings.Contains(w.Body.String(), "<h1>API documentation</h1>") || w.Header().Get("X-Robots-Tag") != "" {
				t.Fatal("crawlable docs", w.Code, w.Body.String())
			}
			if w := request(t, h, "GET", "/benchmarks?metric=steady", nil, nil); w.Code != 308 || w.Header().Get("Location") != "/benchmarks/?metric=steady" {
				t.Fatal("canonical route", w.Code, w.Header().Get("Location"))
			}
			if w := request(t, h, "GET", "/api/platforms", nil, nil); w.Code != 200 || !strings.Contains(w.Header().Get("Content-Type"), "application/json") {
				t.Fatal("API intercepted", w.Code, w.Body.String())
			}
			if w := request(t, h, "POST", "/api/captures", []byte("{}"), nil); w.Code != http.StatusUnauthorized {
				t.Fatal("capture authorization changed", w.Code)
			}
		})
	}
}
