package api

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestConfigurationCatalogProjectionKeepsIdentityAndOmitsInvocationPaths(t *testing.T) {
	data, err := wire.Encode(map[string]any{
		"id": "engine", "command": []string{"/Users/private/engine", "--cache=/tmp/private"},
		"file_sha256":          map[string]string{"/Users/private/engine": wire.Hash([]byte("engine"))},
		"host_file_sha256":     map[string]string{"/home/private/library": wire.Hash([]byte("library"))},
		"future_private_field": "/Users/private/tool",
		"description": map[string]any{
			"runtime": "engine", "runtime_version": "1.2.3", "backend": "compiler", "embedding": "in-process",
			"capabilities": map[string]bool{"code-image": true}, "features": []string{"simd"},
			"build": "/tmp/private/build", "effective_configuration": map[string]string{"cache_dir": "/home/private/cache", "optimization": "speed"},
			"future_private_field": "/Users/private/diagnostic",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	canonical := wire.Record{Kind: "configuration", ID: wire.Hash(data), Data: data}
	before := bytes.Clone(data)
	summary, err := configurationSummary(canonical)
	if err != nil || summary.ID != canonical.ID || summary.Kind != canonical.Kind || !bytes.Equal(canonical.Data, before) {
		t.Fatal("projection changed canonical identity/data", err)
	}
	for _, private := range []string{"/Users/", "/tmp/", "/home/", "command", "file_sha256", "build", "effective_configuration", "future_private_field"} {
		if bytes.Contains(summary.Data, []byte(private)) {
			t.Fatal("private invocation/dependency metadata in summary", private)
		}
	}
	var public struct {
		ID          string `json:"id"`
		Description struct {
			Runtime      string          `json:"runtime"`
			Version      string          `json:"runtime_version"`
			Backend      string          `json:"backend"`
			Capabilities map[string]bool `json:"capabilities"`
		} `json:"description"`
	}
	if err := json.Unmarshal(summary.Data, &public); err != nil {
		t.Fatal(err)
	}
	if public.ID != "engine" || public.Description.Version != "1.2.3" || public.Description.Runtime != "engine" || public.Description.Backend != "compiler" || !public.Description.Capabilities["code-image"] {
		t.Fatal("display facts changed", public)
	}
}

func TestConfigurationProjectionHTTPPolicyPinAndCanonicalDetail(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	revision := importFixture(t, a.Store, "configuration-summary", time.Now().UTC())
	path := "/api/v1/configurations?revision=" + revision
	unpinned := request(t, h, "GET", path, nil, nil)
	if unpinned.Code != 200 || strings.Contains(unpinned.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("unversioned projection cached immutably", unpinned.Code)
	}
	var page struct {
		Projection string        `json:"projection"`
		Items      []wire.Record `json:"items"`
	}
	if err := json.Unmarshal(unpinned.Body.Bytes(), &page); err != nil || page.Projection != configurationProjection || len(page.Items) == 0 {
		t.Fatal("projection identity absent", err)
	}
	pinned := request(t, h, "GET", path+"&projection="+configurationProjection, nil, nil)
	if pinned.Code != 200 || !strings.Contains(pinned.Header().Get("Cache-Control"), "immutable") || !bytes.Equal(pinned.Body.Bytes(), unpinned.Body.Bytes()) {
		t.Fatal("pinned projection differs", pinned.Code)
	}
	if bad := request(t, h, "GET", path+"&projection=unknown", nil, nil); bad.Code != 400 {
		t.Fatal("unknown projection interpreted", bad.Code)
	}
	r := page.Items[0]
	canonical, err := a.Store.Record(revision, "configuration", r.ID)
	if err != nil {
		t.Fatal(err)
	}
	response := request(t, h, "GET", "/api/v1/configurations/"+r.ID+"?revision="+revision, nil, nil)
	var detail struct {
		Record wire.Record `json:"record"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &detail) != nil || !bytes.Equal(detail.Record.Data, canonical.Data) {
		t.Fatal("canonical detail modified", response.Code)
	}
}
