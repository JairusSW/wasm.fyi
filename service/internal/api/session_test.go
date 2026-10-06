package api

import (
	"bytes"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func TestSessionAPIRequiresPublishedScopeAndPinsPagination(t *testing.T) {
	s, e := store.Open(t.TempDir(), "test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	h, e := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if e != nil {
		t.Fatal(e)
	}
	first := importFixture(t, s, "one", time.Now().UTC())
	second := importFixture(t, s, "two", time.Now().UTC().Add(time.Hour))
	w := request(t, h, "GET", "/api/v1/sessions/synthetic-session?revision="+first, nil, nil)
	var info struct {
		PublishedJobs      int
		CollectionComplete *bool
		PlannedJobs        *int
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &info) != nil || info.PublishedJobs != 1 || info.CollectionComplete != nil || info.PlannedJobs != nil {
		t.Fatal("session completeness manufactured", w.Code, w.Body.String())
	}
	path := "/api/v1/sessions/synthetic-session/jobs"
	w = request(t, h, "GET", path+"?revision="+second+"&limit=1", nil, nil)
	var page struct {
		Revision, NextCursor string
		Total                int
		Items                []json.RawMessage
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 2 || len(page.Items) != 1 || page.NextCursor == "" {
		t.Fatal("session page invalid", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "inventoryPages") || strings.Contains(w.Body.String(), "objects") || strings.Contains(w.Body.String(), "exporterIdentity") {
		t.Fatal("session page embeds evidence")
	}
	cursor := page.NextCursor
	importFixture(t, s, "three", time.Now().UTC().Add(2*time.Hour))
	w = request(t, h, "GET", path+"?limit=1&cursor="+url.QueryEscape(cursor), nil, nil)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Revision != second || page.Total != 2 {
		t.Fatal("session cursor moved with publication", w.Code, w.Body.String())
	}
	if w = request(t, h, "GET", path+"?limit=2&cursor="+url.QueryEscape(cursor), nil, nil); w.Code != 400 {
		t.Fatal("page size cursor mutation accepted")
	}
	for _, path := range []string{"/api/v1/sessions/synthetic-session?limit=1", "/api/v1/sessions/synthetic-session/jobs?machine=test", "/api/v1/sessions/."} {
		if w = request(t, h, "GET", path, nil, nil); w.Code != 400 {
			t.Fatal("invalid session route accepted", path, w.Code)
		}
	}
}
