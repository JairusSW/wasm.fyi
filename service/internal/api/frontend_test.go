package api

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func TestFrontendSharesAdmissionAndPreservesAPINamespaces(t *testing.T) {
	s, e := store.Open(t.TempDir(), "test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	calls := 0
	static := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.Write([]byte("shell")) })
	limits := DefaultRequestLimits()
	limits.PublicBurst = 100
	h, e := NewWithFrontend(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32), limits, static)
	if e != nil {
		t.Fatal(e)
	}
	for _, route := range []string{"/", "/bench/a", "/_app/immutable/app.js"} {
		if w := request(t, h, "GET", route, nil, nil); w.Code != 200 || w.Body.String() != "shell" {
			t.Fatal(route)
		}
	}
	for _, route := range []string{"/api", "/api/v1", "/api/v2/anything", "/admin", "/admin/v1", "/admin/v2/anything", "/api/v1/missing"} {
		request(t, h, "GET", route, nil, nil)
	}
	if calls != 3 {
		t.Fatal("reserved namespace reached frontend")
	}
	if w := request(t, h, "GET", "/healthz", nil, nil); w.Code != 200 || w.Body.String() == "shell" {
		t.Fatal("health intercepted")
	}
	limits.PublicBurst = 1
	limits.PublicRate = 0.001
	h, e = NewWithFrontend(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32), limits, static)
	if e != nil {
		t.Fatal(e)
	}
	if w := request(t, h, "GET", "/", nil, nil); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := request(t, h, "GET", "/", nil, nil); w.Code != 429 {
		t.Fatal("static bypassed rate limit")
	}
}
