package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestRegistrationHTTPBeforeMeasurements(t *testing.T) {
	root := t.TempDir()
	s, e := store.Open(filepath.Join(root, "data"), "fixture")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	token := strings.Repeat("t", 40)
	h, e := New(s, token, bytes.Repeat([]byte{1}, 32))
	if e != nil {
		t.Fatal(e)
	}
	auth := map[string]string{"Authorization": "Bearer " + token}
	raw := []byte(`{"schema":1,"configuredHarnessPin":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","machines":[{"name":"local"}],"jobs":[{"id":"corpus-0001"}]}`)
	r := wire.PlanRegistration{Schema: 1, Session: "before-measurements", Plan: wire.Hash(raw), ConfiguredHarnessPin: strings.Repeat("a", 40), SessionPlan: wire.SessionPlan{Schema: 1, Bytes: len(raw), Chunks: []wire.Object{{SHA256: wire.Hash(raw), Bytes: len(raw), Kind: "binary"}}}}
	body, _ := wire.Encode(r)
	path := "/api/v1/collection/sessions/" + r.Session
	if w := request(t, h, "POST", "/admin/v1/plans", body, nil); w.Code != 401 {
		t.Fatal(w.Code, w.Body.String())
	}
	w := request(t, h, "POST", "/admin/v1/plans", body, auth)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var receipt map[string]string
	if e = json.Unmarshal(w.Body.Bytes(), &receipt); e != nil {
		t.Fatal(e)
	}
	id := receipt["id"]
	if w = request(t, h, "GET", path, nil, nil); w.Code != 404 {
		t.Fatal("staging public", w.Code)
	}
	if w = request(t, h, "POST", "/admin/v1/plans/"+id+"/commit", nil, auth); w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = request(t, h, "PUT", "/admin/v1/objects/"+wire.Hash(raw), raw, auth); w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = request(t, h, "POST", "/admin/v1/plans/"+id+"/commit", nil, auth); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = request(t, h, "GET", path, nil, nil)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var scope store.RegisteredSession
	if e = json.Unmarshal(w.Body.Bytes(), &scope); e != nil || scope.PlannedJobs != 1 || scope.RegistrationID != id || s.Current() != "" {
		t.Fatal(scope, e)
	}
	if strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("live scope cached as immutable")
	}
	for _, query := range []string{"?revision=" + strings.Repeat("b", 64), "?limit=1", "?cursor=signed"} {
		if w = request(t, h, "GET", path+query, nil, nil); w.Code != 400 {
			t.Fatal(query, w.Code)
		}
	}
	u := wire.Progress{Schema: 1, Session: r.Session, Plan: r.Plan, Machine: "local", Corpus: "corpus-0001", Attempt: "first", Sequence: 1, Status: "running", Phase: "timing", ObservedAt: time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)}
	encoded, _ := wire.Encode(u)
	if w = request(t, h, "POST", "/admin/v1/progress", encoded, nil); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w = request(t, h, "POST", "/admin/v1/progress", encoded, auth); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	progressPath := path + "/attempts/local/corpus-0001/first"
	if w = request(t, h, "GET", progressPath, nil, nil); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = request(t, h, "GET", progressPath+"?revision="+strings.Repeat("b", 64), nil, nil); w.Code != 400 {
		t.Fatal(w.Code)
	}
	u.Sequence = 3
	encoded, _ = wire.Encode(u)
	if w = request(t, h, "POST", "/admin/v1/progress", encoded, auth); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	u.Sequence = 1
	u.Attempt = "second"
	encoded, _ = wire.Encode(u)
	if w = request(t, h, "POST", "/admin/v1/progress", encoded, auth); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	pagePath := path + "/attempts?limit=1"
	w = request(t, h, "GET", pagePath, nil, nil)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var page struct {
		Next  string `json:"nextCursor"`
		Total int    `json:"total"`
	}
	if e = json.Unmarshal(w.Body.Bytes(), &page); e != nil || page.Total != 2 || page.Next == "" {
		t.Fatal(page, e)
	}
	if w = request(t, h, "GET", pagePath+"&cursor="+url.QueryEscape(page.Next), nil, nil); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = request(t, h, "GET", pagePath+"&status=completed&cursor="+url.QueryEscape(page.Next), nil, nil); w.Code != 400 {
		t.Fatal("cursor filters changed", w.Code, w.Body.String())
	}
	u.Sequence = 2
	u.Status = "completed"
	encoded, _ = wire.Encode(u)
	if w = request(t, h, "POST", "/admin/v1/progress", encoded, auth); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = request(t, h, "GET", pagePath+"&cursor="+url.QueryEscape(page.Next), nil, nil); w.Code != 409 {
		t.Fatal("changed view continued", w.Code, w.Body.String())
	}
	for _, query := range []string{"?limit=101", "?revision=" + strings.Repeat("b", 64), "?status=published"} {
		if w = request(t, h, "GET", path+"/attempts"+query, nil, nil); w.Code != 400 {
			t.Fatal(query, w.Code, w.Body.String())
		}
	}
	if w = request(t, h, "POST", "/admin/v1/plans/"+id+"/abort", nil, auth); w.Code != http.StatusConflict {
		t.Fatal(w.Code, w.Body.String())
	}
}
