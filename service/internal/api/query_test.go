package api

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func TestStrictQueryAcrossRoutes(t *testing.T) {
	s, err := store.Open(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	token := strings.Repeat("x", 32)
	handler, err := New(s, token, bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	revision := importFixture(t, s, "query-contract", time.Now().UTC())
	cases := []string{
		"/api/v1/manifest?unexpected=1",
		"/api/v1/manifest?revision=" + revision,
		"/api/v1/results?revision=" + revision + "&revision=" + revision,
		"/api/v1/results?%ZZ=1",
		"/api/v1/results?metric=x;profile=timing",
		"/api/v1/results?workload=%FF",
		"/api/v1/results?workload=%00",
		"/api/v1/results?revision=",
		"/api/v1/results?limit=",
		"/api/v1/results?cursor=",
		"/api/v1/reports/" + strings.Repeat("a", 64) + "?cursor=opaque",
		"/api/v1/revisions/" + revision + "?limit=10",
		"/api/v1/revisions?limit=1&limit=1",
		"/api/v1/artifacts/" + strings.Repeat("a", 64) + "/content?length=1&length=2",
		"/api/v1/results/" + strings.Repeat("a", 64) + "/samples?chunk=not-a-digest",
		"/api/v1/results?workload=" + strings.Repeat("a", 4097),
		"/api/v1/results?" + strings.Repeat("x", 16*1024+1),
		"/readyz?unexpected=1",
		"/healthz?unexpected=1",
		"/admin/v1/metrics?unexpected=1",
		"/admin/v1/imports/" + strings.Repeat("a", 64) + "/missing?offset=0&offset=1",
	}
	for _, path := range cases {
		response := request(t, handler, "GET", path, nil, map[string]string{"Authorization": "Bearer " + token})
		if response.Code != 400 {
			t.Fatalf("ambiguous query %s returned %d: %s", path, response.Code, response.Body.String())
		}
	}
	importFixture(t, s, "query-next", time.Now().UTC().Add(time.Hour))
	first := request(t, handler, "GET", "/api/v1/revisions?limit=1", nil, nil)
	var page struct {
		Next string `json:"nextCursor"`
	}
	if err = json.Unmarshal(first.Body.Bytes(), &page); err != nil || page.Next == "" {
		t.Fatal("missing revision cursor", err)
	}
	changed := request(t, handler, "GET", "/api/v1/revisions?limit=2&cursor="+page.Next, nil, nil)
	if changed.Code != 400 {
		t.Fatal("revision cursor ignored page-size binding", changed.Code)
	}
	for _, path := range []string{"/api/v1/manifest", "/api/v1/results?revision=" + revision + "&selection=s1&limit=1", "/api/v1/results?revision=" + revision + "&selection=s2&limit=1", "/api/v1/revisions/" + revision, "/healthz"} {
		response := request(t, handler, "GET", path, nil, nil)
		if response.Code != 200 {
			t.Fatal("valid route rejected", path, response.Code, response.Body.String())
		}
	}
}
