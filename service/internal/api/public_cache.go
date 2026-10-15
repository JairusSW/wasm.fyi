package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"
)

const publicCacheBytes = 512 << 20
const publicCacheEntries = 2048

// Cache only public benchmark reads. Revision keys make ingestion/removal visible
// immediately; cookies, authorization and dashboard responses never enter it.
type publicResponse struct {
	header  http.Header
	body    []byte
	decoded int
	expires time.Time
}
type publicResponseCache struct {
	mu      sync.Mutex
	entries map[string]publicResponse
	pending map[string]chan struct{}
	bytes   int
}

func newPublicResponseCache() *publicResponseCache {
	return &publicResponseCache{entries: make(map[string]publicResponse), pending: make(map[string]chan struct{})}
}
func publicRead(path string) bool {
	switch path {
	case "/api/table", "/api/matrix", "/api/summary", "/api/platforms", "/api/aggregates", "/api/history/summary", "/api/history/comparison", "/api/history/report":
		return true
	}
	return false
}

type cacheRecorder struct {
	*httptest.ResponseRecorder
	decoded int
}

func (w *cacheRecorder) decodedJSON(n int) { w.decoded = n }
func (a *benchmarkAPI) cachedRead(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	revisionDB, ok := a.db.(interface {
		PublicRevision(context.Context) (string, error)
	})
	if !ok || r.Method != "GET" || !publicRead(r.URL.Path) {
		next(w, r)
		return
	}
	rev, err := revisionDB.PublicRevision(r.Context())
	if err != nil {
		benchmarkProblem(w, r, err)
		return
	}
	encoding := "identity"
	if acceptsGzip(r.Header.Get("Accept-Encoding")) {
		encoding = "gzip"
	}
	key := rev + "|" + r.URL.Path + "?" + r.URL.Query().Encode() + "|" + encoding
	c := a.responses
	for {
		c.mu.Lock()
		entry, found := c.entries[key]
		if found && time.Now().Before(entry.expires) {
			c.mu.Unlock()
			replayPublic(w, r, entry)
			return
		}
		if waiting := c.pending[key]; waiting != nil {
			c.mu.Unlock()
			select {
			case <-waiting:
				continue
			case <-r.Context().Done():
				return
			}
		}
		c.pending[key] = make(chan struct{})
		c.mu.Unlock()
		break
	}
	recorder := &cacheRecorder{ResponseRecorder: httptest.NewRecorder()}
	clone := r.Clone(r.Context())
	clone.Header = r.Header.Clone()
	clone.Header.Del("If-None-Match")
	next(recorder, clone)
	entry := publicResponse{recorder.Header().Clone(), append([]byte(nil), recorder.Body.Bytes()...), recorder.decoded, time.Now().Add(30 * time.Second)}
	c.mu.Lock()
	if recorder.Code == 200 && len(entry.body) <= 8<<20 {
		if old, ok := c.entries[key]; ok {
			c.bytes -= len(old.body)
			delete(c.entries, key)
		}
		// Bound both compressed and identity representations, including arbitrary queries.
		for k, v := range c.entries {
			if time.Now().After(v.expires) || c.bytes+len(entry.body) > publicCacheBytes || len(c.entries) >= publicCacheEntries {
				c.bytes -= len(v.body)
				delete(c.entries, k)
			}
		}
		c.entries[key] = entry
		c.bytes += len(entry.body)
	}
	close(c.pending[key])
	delete(c.pending, key)
	c.mu.Unlock()
	if recorder.Code == 200 {
		replayPublic(w, r, entry)
	} else {
		for k, v := range entry.header {
			w.Header()[k] = v
		}
		w.WriteHeader(recorder.Code)
		_, _ = w.Write(entry.body)
	}
}
func replayPublic(w http.ResponseWriter, r *http.Request, v publicResponse) {
	for k, values := range v.header {
		w.Header()[k] = append([]string(nil), values...)
	}
	if etag := v.header.Get("ETag"); etag != "" && r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if observed, ok := w.(interface{ decodedJSON(int) }); ok {
		observed.decodedJSON(v.decoded)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(v.body)
}
