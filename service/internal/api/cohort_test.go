package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func importCohort(t *testing.T, s *store.Store, seed string, cells []testutil.CohortCell) string {
	t.Helper()
	job, objects, e := testutil.CohortFixture(seed, time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC), cells)
	if e != nil {
		t.Fatal(e)
	}
	for id, b := range objects {
		if e = s.Install(id, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	rev, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	return rev
}

func TestCohortCacheHasFixedCapacityAndRejectsOversizedEntries(t *testing.T) {
	cache := &cohortCache{entries: map[string]*store.Cohort{}}
	for i := 0; i < 40; i++ {
		cache.put(strconv.Itoa(i), &store.Cohort{Digest: strings.Repeat("a", 64)})
	}
	if len(cache.entries) != 16 || cache.bytes > cohortCacheBytes || cache.get("0") != nil || cache.get("39") == nil {
		t.Fatal("cache state exceeded admission bounds")
	}
	cache.put("oversized", &store.Cohort{Digest: strings.Repeat("x", cohortCacheBytes)})
	if cache.get("oversized") != nil || len(cache.entries) != 16 {
		t.Fatal("oversized entry retained or evicted useful entries")
	}
}
func apiCohortScope(t *testing.T, s *store.Store, rev string) store.CohortScope {
	t.Helper()
	scope := store.CohortScope{Revision: rev, LaneKind: "track", Policy: "shared-geometric-v1", Weighting: "workload", Workloads: "applications", MixedConfigurations: "reject", Collectors: "allow-unrecorded-timing", Definitions: "require-registered", Contracts: "latest-in-scope"}
	rows, e := s.Results(store.Query{Revision: rev}, false)
	if e != nil {
		t.Fatal(e)
	}
	lanes := map[string]bool{}
	for _, r := range rows {
		var v wire.Result
		_ = json.Unmarshal(r.Data, &v)
		scope.Environment = v.EnvironmentID
		scope.Selectors = []store.CohortSelector{{Definition: v.MetricDefinitionID, Method: v.MeasurementMethodID, Analysis: v.AnalysisVersion}}
		lanes[v.TrackID] = true
		if v.Runtime == "a" {
			scope.Baseline = v.TrackID
		}
	}
	for id := range lanes {
		scope.Lanes = append(scope.Lanes, id)
	}
	return scope
}
func TestCohortAPIPagePinsScopeAndRecomputesAfterRestore(t *testing.T) {
	s, e := store.Open(filepath.Join(t.TempDir(), "live"), "test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	importCohort(t, s, "one", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Value: 4}, {Runtime: "b", Workload: "fixture/one", Group: "x", Value: 16}})
	rev := importCohort(t, s, "two", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/two", Group: "y", Value: 16}, {Runtime: "b", Workload: "fixture/two", Group: "y", Value: 64}})
	key, e := s.CursorKey()
	if e != nil {
		t.Fatal(e)
	}
	token := strings.Repeat("x", 32)
	h, e := New(s, token, key)
	if e != nil {
		t.Fatal(e)
	}
	scope := apiCohortScope(t, s, rev)
	b, _ := wire.Encode(scope)
	w := request(t, h, "GET", "/api/v1/aggregates?scope="+url.QueryEscape(string(b)), nil, nil)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var summary struct {
		Cohort, Digest string
		Comparison     struct {
			Populations []struct {
				Configuration string
				Value         float64
				Count         int
				Members       []json.RawMessage
				Reports       []string
			}
		}
	}
	if e = json.Unmarshal(w.Body.Bytes(), &summary); e != nil {
		t.Fatal(e)
	}
	for _, p := range summary.Comparison.Populations {
		want := 32.0
		if p.Configuration == scope.Baseline {
			want = 8
		}
		if p.Count != 2 || math.Abs(p.Value-want) > 1e-10 || len(p.Members) != 0 || len(p.Reports) != 0 {
			t.Fatal("summary preloaded evidence or used a page cohort")
		}
	}
	path := "/api/v1/cohorts/" + summary.Cohort
	w = request(t, h, "GET", path+"?limit=1", nil, nil)
	var page struct {
		Revision, Digest, Next string
		NextCursor             string
		Total                  int
		Complete               bool
		Items                  []json.RawMessage
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 1 || page.Total != 4 || page.NextCursor == "" {
		t.Fatal("unbounded membership page", w.Code, w.Body.String())
	}
	seen := map[string]bool{string(page.Items[0]): true}
	cursor := page.NextCursor
	importCohort(t, s, "new", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/three", Group: "x", Value: 100}, {Runtime: "b", Workload: "fixture/three", Group: "x", Value: 400}})
	// A new handler has an empty cache; opaque scope IDs remain reconstructible.
	h, _ = New(s, token, key)
	for cursor != "" {
		w = request(t, h, "GET", path+"?limit=1&cursor="+url.QueryEscape(cursor), nil, nil)
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Revision != rev || page.Digest != summary.Digest || page.Total != 4 {
			t.Fatal("revision drift across cohort pages", w.Code, w.Body.String())
		}
		for _, item := range page.Items {
			if seen[string(item)] {
				t.Fatal("duplicate member")
			}
			seen[string(item)] = true
		}
		cursor = page.NextCursor
	}
	if len(seen) != 4 {
		t.Fatal("membership omitted")
	}
	w = request(t, h, "GET", path+"?limit=1", nil, nil)
	_ = json.Unmarshal(w.Body.Bytes(), &page)
	if request(t, h, "GET", path+"?limit=2&cursor="+url.QueryEscape(page.NextCursor), nil, nil).Code != 400 {
		t.Fatal("page-size cursor mutation accepted")
	}
	if request(t, h, "GET", path+"?lane="+scope.Baseline+"&cursor="+url.QueryEscape(page.NextCursor), nil, nil).Code != 400 {
		t.Fatal("lane cursor mutation accepted")
	}
	if request(t, h, "GET", path+"x", nil, nil).Code != 400 {
		t.Fatal("tampered scope token accepted")
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(context.Background(), backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = store.Rebuild(backup, rebuilt, "test"); e != nil {
		t.Fatal(e)
	}
	r, e := store.Open(rebuilt, "test")
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	restoredKey, e := r.CursorKey()
	if e != nil {
		t.Fatal(e)
	}
	h, e = New(r, token, restoredKey)
	if e != nil {
		t.Fatal(e)
	}
	w = request(t, h, "GET", path+"?limit=100", nil, nil)
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 4 || page.Digest != summary.Digest {
		t.Fatal("cohort identity depends on cache or Pebble snapshot", w.Code, w.Body.String())
	}
}

func TestCohortVersionChangeRejectsAuthenticOlderTokens(t *testing.T) {
	s, err := store.Open(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rev := importCohort(t, s, "versioned", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Value: 4}, {Runtime: "b", Workload: "fixture/one", Group: "x", Value: 16}})
	scope := apiCohortScope(t, s, rev)
	key := bytes.Repeat([]byte{7}, 32)
	h, err := New(s, strings.Repeat("x", 32), key)
	if err != nil {
		t.Fatal(err)
	}
	for _, version := range []string{"wasmfyi-cohort-v1", "wasmfyi-cohort-v2", "wasmfyi-cohort-v3"} {
		old, _ := wire.Encode(cohortCapsule{version, comparison.CategoryVersion, scope})
		mac := hmac.New(sha256.New, key)
		mac.Write([]byte("cohort-v1:"))
		mac.Write(old)
		token := base64.RawURLEncoding.EncodeToString(old) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
		if w := request(t, h, "GET", "/api/v1/cohorts/"+token, nil, nil); w.Code != 400 {
			t.Fatal("older comparison token reused under changed response", version, w.Code)
		}
	}
	body, _ := wire.Encode(scope)
	w := request(t, h, "GET", "/api/v1/overview?scope="+url.QueryEscape(string(body)), nil, nil)
	var overview overviewResponse
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &overview) != nil {
		t.Fatal("current overview unavailable", w.Code, w.Body.String())
	}
	if w = request(t, h, "GET", "/api/v1/cohorts/"+overview.Cohort, nil, nil); w.Code != 200 {
		t.Fatal("current comparison identity rejected", w.Code, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatal("signed member page not immutable")
	}
	for _, endpoint := range []string{"overview", "aggregates"} {
		base := "/api/v1/" + endpoint + "?scope=" + url.QueryEscape(string(body))
		unversioned := request(t, h, "GET", base, nil, nil)
		if unversioned.Code != 200 || unversioned.Header().Get("Cache-Control") != "no-cache" {
			t.Fatal("unversioned analysis cached immutable", endpoint)
		}
		pinned := request(t, h, "GET", base+"&version="+comparison.Version, nil, nil)
		if pinned.Code != 200 || !strings.Contains(pinned.Header().Get("Cache-Control"), "immutable") {
			t.Fatal("pinned comparison not immutable", endpoint, pinned.Code)
		}
		for _, version := range []string{"wasmfyi-cohort-v1", "wasmfyi-cohort-v2", "wasmfyi-cohort-v3"} {
			if request(t, h, "GET", base+"&version="+version, nil, nil).Code != 400 {
				t.Fatal("older policy silently reinterpreted", endpoint, version)
			}
		}
	}
	if overview.Interpretation.Version != comparison.Version || overview.Interpretation.ContractSelection == "" {
		t.Fatal("current scope interpretation missing")
	}

	if comparison.Version != "wasmfyi-cohort-v4" {
		t.Fatal("unversioned contract-selection fix")
	}
}
