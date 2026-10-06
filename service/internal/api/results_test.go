package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestResultCacheBoundsEmptyAndCanceledQueries(t *testing.T) {
	cache := &resultCache{entries: map[string]resultCacheEntry{}}
	for i := 0; i < 40; i++ {
		cache.put(strconv.Itoa(i), []wire.Record{})
	}
	if len(cache.entries) != resultCacheEntries || cache.bytes > resultCacheBytes {
		t.Fatal("cache exceeded count/byte bounds")
	}
	if rows, ok := cache.get("39"); !ok || len(rows) != 0 {
		t.Fatal("empty query not cached")
	}
	cache.put("large", []wire.Record{{Data: json.RawMessage(strings.Repeat("x", resultCacheBytes))}})
	if _, ok := cache.get("large"); ok {
		t.Fatal("oversized query retained")
	}
	for i := 0; i < 40; i++ {
		cache.put("bytes-"+strconv.Itoa(i), []wire.Record{{Data: json.RawMessage(strings.Repeat("x", 512<<10))}})
	}
	if cache.bytes > resultCacheBytes || len(cache.entries) > resultCacheEntries {
		t.Fatal("combined byte admission exceeded bounds")
	}
	q := store.Query{Revision: strings.Repeat("a", 64), Selection: "current", Sort: "catalog", Limit: 100}
	cacheQuery := q
	cacheQuery.Limit = 0
	b, _ := wire.Encode(cacheQuery)
	cache.put(wire.Hash(append([]byte("results:"), b...)), []wire.Record{})
	a := &API{results: cache, selecting: make(chan struct{}, 2)} // nil store proves cache hit avoids a read
	q.Limit = 1
	if _, err := a.resultRows(context.Background(), q, false); err != nil {
		t.Fatal("page size prevented reuse", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := a.resultRows(ctx, q, false); !errors.Is(err, context.Canceled) {
		t.Fatal("cache ignored cancellation", err)
	}
	a.selecting <- struct{}{}
	a.selecting <- struct{}{}
	q.Runtime = "different"
	if _, err := a.resultRows(context.Background(), q, false); !errors.Is(err, errQueryBusy) {
		t.Fatal("query admission not bounded", err)
	}
}

func TestSelectedResultPageNeverSerializesUnreturnedRows(t *testing.T) {
	a := &API{CursorKey: bytes.Repeat([]byte{1}, 32)}
	rows := []wire.Record{{Kind: "result", ID: strings.Repeat("a", 64), Data: json.RawMessage(`{"summary":{"size_bytes":"9007199254740993"}}`)}, {Kind: "result", ID: strings.Repeat("b", 64), Data: json.RawMessage(`INVALID JSON OUTSIDE PAGE`)}}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/v1/results", nil)
	a.resultPage(w, r, strings.Repeat("c", 64), "query", rows, 1, cursor{}, true)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "9007199254740993") {
		t.Fatal("encoded outside selected page", w.Code, w.Body.String())
	}
	var page struct {
		Total      int
		Complete   bool
		NextCursor string
	}
	if json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 2 || page.Complete || page.NextCursor == "" {
		t.Fatal("lost completeness", w.Body.String())
	}
}

func TestResultSummariesReferenceExactMethodAndKeepProvenance(t *testing.T) {
	s, err := store.Open(filepath.Join(t.TempDir(), "data"), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rev := importCohort(t, s, "method-one", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", ExactValue: "9007199254740993"}, {Runtime: "a", Workload: "fixture/two", Group: "y", Value: 4}})
	scope := apiCohortScope(t, s, rev)
	key, err := s.CursorKey()
	if err != nil {
		t.Fatal(err)
	}
	h, err := New(s, strings.Repeat("x", 32), key)
	if err != nil {
		t.Fatal(err)
	}
	w := request(t, h, "GET", "/api/v1/results?revision="+rev+"&limit=1", nil, nil)
	var page struct {
		Items      []wire.Record
		NextCursor string
		Total      int
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 2 || len(page.Items) != 1 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result wire.Result
	if json.Unmarshal(page.Items[0].Data, &result) != nil || result.MeasurementMethod != nil || result.MeasurementMethodID != scope.Selectors[0].Method || len(result.Evidence) != 0 || !strings.Contains(string(result.Summary), "9007199254740993") {
		t.Fatal("summary lost exact value/method reference", w.Body.String())
	}
	detail := request(t, h, "GET", "/api/v1/results/"+page.Items[0].ID+"?revision="+rev, nil, nil)
	if detail.Code != 200 || !strings.Contains(detail.Body.String(), `"recipe"`) {
		t.Fatal("detail lost producer method", detail.Code, detail.Body.String())
	}
	methodPath := "/api/v1/methods/" + result.MeasurementMethodID + "?revision=" + rev + "&definition=" + result.MetricDefinitionID
	method := request(t, h, "GET", methodPath, nil, nil)
	var descriptor struct {
		ID     string
		Method wire.MeasurementMethod
	}
	if method.Code != 200 || json.Unmarshal(method.Body.Bytes(), &descriptor) != nil || descriptor.ID != descriptor.Method.ID() {
		t.Fatal("method identity drift", method.Code, method.Body.String())
	}
	for _, path := range []string{"/api/v1/methods/" + result.MeasurementMethodID, methodPath + "&definition=" + result.MetricDefinitionID, strings.Replace(methodPath, "definition="+result.MetricDefinitionID, "definition=invalid", 1)} {
		if request(t, h, "GET", path, nil, nil).Code != 400 {
			t.Fatal("bad method scope accepted", path)
		}
	}
	unknown := strings.Repeat("f", 64)
	if request(t, h, "GET", "/api/v1/methods/"+unknown+"?revision="+rev+"&definition="+result.MetricDefinitionID, nil, nil).Code != 404 {
		t.Fatal("unpublished method exposed")
	}
	cursor := page.NextCursor
	importCohort(t, s, "method-two", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/three", Group: "z", Value: 8}})
	w = request(t, h, "GET", "/api/v1/results?limit=1&cursor="+url.QueryEscape(cursor), nil, nil)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 2 || len(page.Items) != 1 {
		t.Fatal("cached cursor changed revision", w.Code, w.Body.String())
	}
	if request(t, h, "GET", "/api/v1/results?revision="+s.Current()+"&limit=1", nil, nil).Code != 200 {
		t.Fatal("new publication inaccessible")
	}
	newRevision := importCohort(t, s, "new-method", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/four", Group: "x", Value: 2, Scenario: "first-call"}})
	newRows, err := s.Results(store.Query{Revision: newRevision, Scenario: "first-call"}, false)
	if err != nil || len(newRows) != 1 {
		t.Fatal("new method fixture", err)
	}
	var newResult wire.Result
	if err = json.Unmarshal(newRows[0].Data, &newResult); err != nil {
		t.Fatal(err)
	}
	newPath := "/api/v1/methods/" + newResult.MeasurementMethodID + "?definition=" + newResult.MetricDefinitionID
	if request(t, h, "GET", newPath+"&revision="+rev, nil, nil).Code != 404 || request(t, h, "GET", newPath+"&revision="+newRevision, nil, nil).Code != 200 {
		t.Fatal("method escaped its published revision")
	}
}

func TestResultPageBudgetPreservesRemainder(t *testing.T) {
	a := &API{CursorKey: bytes.Repeat([]byte{1}, 32)}
	rows := []wire.Record{}
	for i := 0; i < 5; i++ {
		data, _ := wire.Encode(map[string]any{"summary": map[string]string{"reason": strings.Repeat("x", 250000)}})
		rows = append(rows, wire.Record{Kind: "result", ID: wire.Hash([]byte(strconv.Itoa(i))), Data: data})
	}
	revision := strings.Repeat("a", 64)
	request := httptest.NewRequest("GET", "/api/v1/results", nil)
	cur := cursor{}
	seen := map[string]bool{}
	for {
		w := httptest.NewRecorder()
		a.resultPage(w, request, revision, "budget", rows, 5, cur, true)
		var page struct {
			Items      []wire.Record
			Total      int
			Complete   bool
			NextCursor string
		}
		if w.Code != 200 || w.Body.Len() > wire.ResponseBytes || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 5 || len(page.Items) == 0 {
			t.Fatal("page budget", w.Code, w.Body.Len())
		}
		for _, row := range page.Items {
			if seen[row.ID] {
				t.Fatal("duplicate budget-boundary row")
			}
			seen[row.ID] = true
		}
		if page.Complete {
			break
		}
		var err error
		cur, err = a.parse(page.NextCursor)
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(seen) != 5 {
		t.Fatal("response ceiling discarded rows")
	}
}
