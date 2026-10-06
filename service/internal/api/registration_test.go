package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

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
	if w = request(t, h, "POST", "/admin/v1/plans/"+id+"/abort", nil, auth); w.Code != http.StatusConflict {
		t.Fatal(w.Code, w.Body.String())
	}
}
