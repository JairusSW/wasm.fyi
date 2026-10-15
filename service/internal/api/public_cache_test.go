package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

type cacheTestStore struct {
	BenchmarkStore
	revision atomic.Int64
}

func (s *cacheTestStore) PublicRevision(context.Context) (string, error) {
	return fmt.Sprint(s.revision.Load()), nil
}
func TestPublicCacheCoalescesAndInvalidates(t *testing.T) {
	store := &cacheTestStore{}
	a := &benchmarkAPI{db: store, responses: newPublicResponseCache()}
	var calls atomic.Int64
	began, release := make(chan struct{}), make(chan struct{})
	next := func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(began)
			<-release
		}
		respond(w, r, 200, map[string]int64{"revision": store.revision.Load()}, false)
	}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			a.cachedRead(w, httptest.NewRequest("GET", "/api/table?platform=test", nil), next)
			if w.Code != 200 {
				t.Errorf("status %d", w.Code)
			}
		}()
	}
	<-began
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("built %d times", calls.Load())
	}
	first := httptest.NewRecorder()
	a.cachedRead(first, httptest.NewRequest("GET", "/api/table?platform=test", nil), next)
	request := httptest.NewRequest("GET", "/api/table?platform=test", nil)
	request.Header.Set("If-None-Match", first.Header().Get("ETag"))
	conditional := httptest.NewRecorder()
	a.cachedRead(conditional, request, next)
	if conditional.Code != 304 || conditional.Body.Len() != 0 || calls.Load() != 1 {
		t.Fatal("conditional hit rebuilt response")
	}
	store.revision.Add(1)
	fresh := httptest.NewRecorder()
	a.cachedRead(fresh, request, next)
	if fresh.Code != 200 || calls.Load() != 2 || fresh.Header().Get("ETag") == first.Header().Get("ETag") {
		t.Fatal("revision did not invalidate")
	}
	// The gzip variant must not reuse identity bytes or ETag.
	request.Header.Set("Accept-Encoding", "gzip")
	compressed := httptest.NewRecorder()
	a.cachedRead(compressed, request, next)
	if compressed.Header().Get("Content-Encoding") != "gzip" || calls.Load() != 3 {
		t.Fatal("encoding representations mixed")
	}
}
func TestPublicCacheNeverCachesPrivateOrFailures(t *testing.T) {
	a := &benchmarkAPI{db: &cacheTestStore{}, responses: newPublicResponseCache()}
	calls := 0
	for _, path := range []string{"/api/admin/analytics", "/auth/me", "/admin/v1/summary", "/api/table"} {
		for i := 0; i < 2; i++ {
			a.cachedRead(httptest.NewRecorder(), httptest.NewRequest("GET", path, nil), func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(401) })
		}
	}
	if calls != 8 || len(a.responses.entries) != 0 {
		t.Fatal("cached private/error response")
	}
}
