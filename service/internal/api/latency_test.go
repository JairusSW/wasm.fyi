package api

import (
	"bytes"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestCompactLatencyPublicationAndReplacement(t *testing.T) {
	s, err := store.Open(t.TempDir(), "latency-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	h.(*API).SetLatencyDirectory(t.TempDir())
	value := 12.5
	c := latencyCapture{Schema: 1, CapturedAt: "2026-10-07T12:00:00Z", Platform: latencyPlatform{OS: "linux", Arch: "amd64", CPU: "Fixture CPU", Cores: 4, Kernel: "fixture"}, Results: []latencyRow{{Workload: "applications/test", Wasm: "test.wasm", Artifact: strings.Repeat("a", 64), Contract: strings.Repeat("b", 64), Engine: "wazero", Version: "1.0", Backend: "compiler", Phase: "steady", Status: "ok", Value: &value}}}
	rss, code := 4096.0, 128.0
	c.Results[0].PeakRSS = &rss
	c.Results[0].CodeBytes = &code
	c.Results[0].MemoryStatus = "ok"
	c.Results[0].CodeStatus = "ok"
	payload, _ := json.Marshal(c)
	unauth := request(t, h, http.MethodPost, "/admin/v1/latency", payload, nil)
	if unauth.Code != 401 {
		t.Fatal(unauth.Code, unauth.Body.String())
	}
	headers := map[string]string{"Authorization": "Bearer " + strings.Repeat("x", 32)}
	posted := request(t, h, http.MethodPost, "/admin/v1/latency", payload, headers)
	if posted.Code != 201 {
		t.Fatal(posted.Code, posted.Body.String())
	}
	var receipt map[string]string
	_ = json.Unmarshal(posted.Body.Bytes(), &receipt)
	read := request(t, h, http.MethodGet, "/api/v1/latency?limit=1", nil, nil)
	if read.Code != 200 {
		t.Fatal(read.Code, read.Body.String())
	}
	var page struct {
		Revision   string
		Items      []latencyRow
		Total      int
		Complete   bool
		NextOffset int
	}
	if err = json.Unmarshal(read.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || !page.Complete || *page.Items[0].Value != 12.5 {
		t.Fatal(read.Body.String())
	}
	if page.Items[0].PeakRSS == nil || *page.Items[0].PeakRSS != 4096 || page.Items[0].CodeBytes == nil || *page.Items[0].CodeBytes != 128 {
		t.Fatal("resource values lost", read.Body.String())
	}
	oldRevision := page.Revision
	value = 8
	c.CapturedAt = "2026-10-07T13:00:00Z"
	payload, _ = json.Marshal(c)
	posted = request(t, h, http.MethodPost, "/admin/v1/latency", payload, headers)
	if posted.Code != 201 {
		t.Fatal(posted.Body.String())
	}
	var replacement map[string]string
	_ = json.Unmarshal(posted.Body.Bytes(), &replacement)
	if replacement["id"] != receipt["id"] {
		t.Fatal("repeated captures should replace the same scope rather than accumulate evidence")
	}
	stale := request(t, h, http.MethodGet, "/api/v1/latency?revision="+url.QueryEscape(oldRevision), nil, nil)
	if stale.Code != 409 {
		t.Fatal(stale.Code, stale.Body.String())
	}
	read = request(t, h, http.MethodGet, "/api/v1/latency", nil, nil)
	_ = json.Unmarshal(read.Body.Bytes(), &page)
	if page.Total != 1 || *page.Items[0].Value != 8 {
		t.Fatal(read.Body.String())
	}
	c.Results[0].MemoryStatus = "unsupported"
	payload, _ = json.Marshal(c)
	badResource := request(t, h, http.MethodPost, "/admin/v1/latency", payload, headers)
	if badResource.Code != 400 {
		t.Fatal("unsupported resource must not carry a value", badResource.Code)
	}
	c.Results[0].MemoryStatus = "ok"
	c.Results[0].Status = "failed"
	payload, _ = json.Marshal(c)
	bad := request(t, h, http.MethodPost, "/admin/v1/latency", payload, headers)
	if bad.Code != 400 {
		t.Fatal("failed cells must not retain successful timing", bad.Code)
	}
}
