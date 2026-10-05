package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func request(t *testing.T, h http.Handler, method, path string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func importFixture(t *testing.T, s *store.Store, seed string, date time.Time) string {
	t.Helper()
	j, objects, e := testutil.Fixture(seed, date)
	if e != nil {
		t.Fatal(e)
	}
	for digest, b := range objects {
		if e = s.Install(digest, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	rev, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	return rev
}
func TestPinnedCursorAndEvidence(t *testing.T) {
	s, e := store.Open(t.TempDir(), "test-publisher")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	h, e := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if e != nil {
		t.Fatal(e)
	}
	old := importFixture(t, s, "first", time.Now().UTC())
	first := request(t, h, "GET", "/api/v1/results?limit=1", nil, nil)
	if first.Code != 200 {
		t.Fatal(first.Body.String())
	}
	var page struct {
		Revision string        `json:"revision"`
		Items    []wire.Record `json:"items"`
		Next     string        `json:"nextCursor"`
		Total    int           `json:"total"`
	}
	if e = json.Unmarshal(first.Body.Bytes(), &page); e != nil {
		t.Fatal(e)
	}
	if len(page.Items) != 1 || page.Next == "" || page.Total != 3 || page.Revision != old {
		t.Fatal("unbounded or incomplete page")
	}
	var result wire.Result
	if e = json.Unmarshal(page.Items[0].Data, &result); e != nil {
		t.Fatal(e)
	}
	var summary map[string]json.RawMessage
	if e = json.Unmarshal(result.Summary, &summary); e != nil {
		t.Fatal(e)
	}
	if _, present := summary["launch_medians"]; present {
		t.Fatal("launch evidence loaded in summary")
	}
	if strings.Contains(first.Body.String(), "sourceSealSha256") {
		t.Fatal("global report loaded")
	}
	importFixture(t, s, "second", time.Now().Add(time.Hour).UTC())
	next := request(t, h, "GET", "/api/v1/results?limit=1&cursor="+url.QueryEscape(page.Next), nil, nil)
	if next.Code != 200 {
		t.Fatal(next.Body.String())
	}
	var newer map[string]any
	_ = json.Unmarshal(next.Body.Bytes(), &newer)
	if newer["revision"] != old {
		t.Fatal("cursor advanced to new revision")
	}
	for _, path := range []string{"/api/v1/results?limit=1&runtime=different&cursor=" + url.QueryEscape(page.Next), "/api/v1/results?cursor=malformed", "/api/v1/results?limit=1001", "/api/v1/results?include=all", "/api/v1/results?sort=value"} {
		if w := request(t, h, "GET", path, nil, nil); w.Code != 400 {
			t.Fatalf("accepted malformed query %s: %d", path, w.Code)
		}
	}
	rows, e := s.Results(store.Query{Revision: old, Metric: "time.wall"}, false)
	if e != nil || len(rows) != 1 {
		t.Fatal(e)
	}
	id := rows[0].ID
	detail := request(t, h, "GET", "/api/v1/results/"+id+"?revision="+old, nil, nil)
	if detail.Code != 200 {
		t.Fatal(detail.Body.String())
	}
	samples := request(t, h, "GET", "/api/v1/results/"+id+"/samples?revision="+old, nil, nil)
	var refs struct {
		Chunks []string `json:"chunks"`
	}
	_ = json.Unmarshal(samples.Body.Bytes(), &refs)
	if len(refs.Chunks) != 1 {
		t.Fatal("missing trial reference")
	}
	chunk := request(t, h, "GET", "/api/v1/results/"+id+"/samples?revision="+old+"&chunk="+refs.Chunks[0], nil, nil)
	if chunk.Code != 200 || !strings.Contains(chunk.Body.String(), `"block":0`) {
		t.Fatal("lost launch identity")
	}
	forged := request(t, h, "GET", "/api/v1/results/"+id+"/samples?revision="+old+"&chunk="+strings.Repeat("a", 64), nil, nil)
	if forged.Code != 404 {
		t.Fatal("unreferenced content exposed")
	}
}
func TestCompressionAndAuthentication(t *testing.T) {
	s, e := store.Open(t.TempDir(), "test-publisher")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	h, e := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if e != nil {
		t.Fatal(e)
	}
	rev := importFixture(t, s, "first", time.Now().UTC())
	path := "/api/v1/results?revision=" + rev
	plain := request(t, h, "GET", path, nil, nil)
	compressed := request(t, h, "GET", path, nil, map[string]string{"Accept-Encoding": "gzip"})
	reader, e := gzip.NewReader(compressed.Body)
	if e != nil {
		t.Fatal(e)
	}
	decoded, e := io.ReadAll(reader)
	reader.Close()
	if e != nil || !bytes.Equal(decoded, plain.Body.Bytes()) {
		t.Fatal("gzip changed payload")
	}
	if compressed.Body.Len() > 50*1024 || len(decoded) > wire.ResponseBytes {
		t.Fatal("result payload over budget")
	}
	if compressed.Header().Get("ETag") == plain.Header().Get("ETag") {
		t.Fatal("representation validators collide")
	}
	if !strings.Contains(plain.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("pinned response not immutable")
	}
	if w := request(t, h, "GET", "/api/v1/results", nil, nil); w.Header().Get("Cache-Control") != "no-cache" {
		t.Fatal("current URL cached forever")
	}
	if w := request(t, h, "GET", path, nil, map[string]string{"If-None-Match": plain.Header().Get("ETag")}); w.Code != 304 {
		t.Fatal("validator ignored")
	}
	if w := request(t, h, "GET", path, nil, map[string]string{"Accept-Encoding": "gzip;q=0"}); w.Header().Get("Content-Encoding") != "" {
		t.Fatal("gzip explicitly refused")
	}
	j, objects, e := testutil.Fixture("third", time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	jb, _ := wire.Encode(j)
	if w := request(t, h, "POST", "/admin/v1/imports", jb, nil); w.Code != 401 {
		t.Fatal("unauthenticated publication")
	}
	auth := map[string]string{"Authorization": "Bearer " + strings.Repeat("x", 32)}
	w := request(t, h, "POST", "/admin/v1/imports", jb, auth)
	if w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	var submitted struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &submitted)
	if w = request(t, h, "POST", "/admin/v1/imports/"+submitted.ID+"/commit", nil, auth); w.Code != 400 {
		t.Fatal("partial upload published")
	}
	for digest, b := range objects {
		if w = request(t, h, "PUT", "/admin/v1/objects/"+digest, b, auth); w.Code != 201 {
			t.Fatal(w.Body.String())
		}
	}
	if w = request(t, h, "POST", "/admin/v1/imports/"+submitted.ID+"/commit", nil, auth); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
}

func TestReadinessAndDeclaredUploads(t *testing.T) {
	s, e := store.Open(t.TempDir(), "test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	token := strings.Repeat("x", 32)
	h, e := New(s, token, bytes.Repeat([]byte{1}, 32))
	if e != nil {
		t.Fatal(e)
	}
	if w := request(t, h, "GET", "/readyz", nil, nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := request(t, h, "GET", "/admin/v1/metrics", nil, nil); w.Code != 401 {
		t.Fatal("unauthenticated metrics")
	}
	auth := map[string]string{"Authorization": "Bearer " + token}
	body := []byte("undeclared")
	if w := request(t, h, "PUT", "/admin/v1/objects/"+wire.Hash(body), body, auth); w.Code != 403 {
		t.Fatal("unrestricted content upload", w.Code, w.Body.String())
	}
	j, _, e := testutil.Fixture("status", time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	b, _ := wire.Encode(j)
	created := request(t, h, "POST", "/admin/v1/imports", b, auth)
	var entry struct {
		ID string `json:"id"`
	}
	if e = json.Unmarshal(created.Body.Bytes(), &entry); e != nil {
		t.Fatal(e)
	}
	status := request(t, h, "GET", "/admin/v1/imports/"+entry.ID, nil, auth)
	if status.Code != 200 || !strings.Contains(status.Body.String(), `"state":"staged"`) {
		t.Fatal(status.Body.String())
	}
	aborted := request(t, h, "POST", "/admin/v1/imports/"+entry.ID+"/abort", nil, auth)
	if aborted.Code != 200 {
		t.Fatal(aborted.Body.String())
	}
	if w := request(t, h, "POST", "/admin/v1/imports/"+entry.ID+"/commit", nil, auth); w.Code != 409 {
		t.Fatal("aborted import published", w.Code)
	}
	stats := request(t, h, "GET", "/admin/v1/metrics", nil, auth)
	if stats.Code != 200 || !strings.Contains(stats.Body.String(), `"pendingJobs":0`) {
		t.Fatal(stats.Body.String())
	}
}
