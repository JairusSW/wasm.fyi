package api

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestResultCacheTelemetrySeparatesHitsFromSelectionWork(t *testing.T) {
	a, _ := telemetryAPI(t, nil)
	a.results = &resultCache{entries: map[string]resultCacheEntry{}}
	rev := importFixture(t, a.Store, "cache-work", time.Now().UTC())
	q := store.Query{Revision: rev, Limit: 1}
	first, e := a.resultRows(context.Background(), q, false)
	if e != nil {
		t.Fatal(e)
	}
	before, e := a.Store.Stats()
	if e != nil {
		t.Fatal(e)
	}
	q.Limit = 2
	second, e := a.resultRows(context.Background(), q, false)
	if e != nil || len(first) != len(second) {
		t.Fatal(e)
	}
	after, e := a.Store.Stats()
	if e != nil {
		t.Fatal(e)
	}
	if before.ResultQueries[0] != after.ResultQueries[0] {
		t.Fatal("cache hit performed fresh selection")
	}
	stats := a.results.stats()
	if stats.Hits != 1 || stats.Misses != 1 || stats.Entries != 1 || stats.AccountedBytes == 0 || stats.AccountedBytes > stats.ByteLimit {
		t.Fatal(stats)
	}
	for i := 0; i < 30; i++ {
		a.results.put(strings.Repeat("k", i+1), nil)
	}
	a.results.put("oversized", []wire.Record{{Data: []byte(strings.Repeat("x", resultCacheBytes))}})
	stats = a.results.stats()
	if stats.Evictions == 0 || stats.Rejected != 1 || stats.Entries > stats.EntryLimit || stats.AccountedBytes > stats.ByteLimit {
		t.Fatal(stats)
	}
}

func TestCohortCacheTelemetryPreservesCompleteComparison(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	a.cohorts = &cohortCache{entries: map[string]*store.Cohort{}}
	revision := importCohort(t, a.Store, "cohort-cache-work", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}, {Runtime: "b", Workload: "fixture/one", Value: 8}})
	scope := apiCohortScope(t, a.Store, revision)
	body, _ := wire.Encode(scope)
	path := "/api/v1/aggregates?scope=" + url.QueryEscape(string(body))
	first := request(t, h, "GET", path, nil, nil)
	if first.Code != 200 {
		t.Fatal(first.Code, first.Body.String())
	}
	before, e := a.Store.Stats()
	if e != nil {
		t.Fatal(e)
	}
	second := request(t, h, "GET", path, nil, nil)
	if second.Code != 200 || second.Body.String() != first.Body.String() {
		t.Fatal("cached comparison drift")
	}
	after, e := a.Store.Stats()
	if e != nil {
		t.Fatal(e)
	}
	if before.ResultQueries[0] != after.ResultQueries[0] {
		t.Fatal("cohort cache repeated source selection")
	}
	stats := a.cohorts.stats()
	if stats.Hits != 1 || stats.Misses != 1 || stats.Entries != 1 || stats.AccountedBytes == 0 || stats.AccountedBytes > stats.ByteLimit {
		t.Fatal(stats)
	}
}
