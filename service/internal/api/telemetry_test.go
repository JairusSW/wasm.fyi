package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func telemetryAPI(t *testing.T, frontend http.Handler) (*API, http.Handler) {
	t.Helper()
	s, e := store.Open(t.TempDir(), "test")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	a := &API{Store: s, Token: strings.Repeat("x", 32), CursorKey: bytes.Repeat([]byte{1}, 32), active: make(chan struct{}, 8), selecting: make(chan struct{}, 2), calculating: make(chan struct{}, 2), downloading: make(chan struct{}, 2), limiter: newRequestLimiter(DefaultRequestLimits()), frontend: frontend}
	return a, http.HandlerFunc(a.serve)
}
func TestRequestTelemetryCountsCompressedBytesAndDoesNotExposeIdentities(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	first := request(t, h, "GET", "/api/v1/manifest", nil, map[string]string{"Accept-Encoding": "gzip"})
	if first.Code != 200 {
		t.Fatal(first.Code)
	}
	second := request(t, h, "GET", "/api/v1/manifest", nil, map[string]string{"Accept-Encoding": "gzip", "If-None-Match": first.Header().Get("ETag")})
	if second.Code != 304 {
		t.Fatal(second.Code)
	}
	request(t, h, "GET", "/admin/v1/metrics", nil, nil)
	stats := a.requestStats()
	route := stats.Routes[6]
	if route.Completed != 2 || route.Active != 0 || route.Statuses[2] != 1 || route.Statuses[3] != 1 || route.WrittenBytes != uint64(first.Body.Len()) || route.DecodedJSONBytes <= route.WrittenBytes || route.Canceled != 0 || route.Deadlines != 0 {
		t.Fatal("request byte/status accounting differs", route)
	}
	var latency uint64
	for _, n := range route.Latency {
		latency += n
	}
	if latency != 2 {
		t.Fatal("latency buckets lost requests")
	}
	response := request(t, h, "GET", "/admin/v1/metrics", nil, map[string]string{"Authorization": "Bearer " + a.Token})
	var snapshot struct{ Requests RequestStats }
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &snapshot) != nil || snapshot.Requests.StartedAt == nil || snapshot.Requests.Version != "http-requests-v1" || len(snapshot.Requests.Routes) != len(requestClasses) {
		t.Fatal(response.Code, response.Body.String())
	}
	for _, forbidden := range []string{a.Token, "manifest?", "127.0.0.1", "/admin/v1/metrics"} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatal("request identity retained in telemetry", forbidden)
		}
	}
}
func TestRequestTelemetryConcurrencyCancelAndAbort(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	a, h := telemetryAPI(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-release; w.Write([]byte("done")) }))
	ctx, cancel := context.WithCancel(context.Background())
	r := httptest.NewRequest("GET", "/private-path", nil).WithContext(ctx)
	done := make(chan struct{})
	go func() { h.ServeHTTP(httptest.NewRecorder(), r); close(done) }()
	<-started
	if stats := a.requestStats(); stats.Routes[8].Active != 1 || stats.Admission.Requests != 1 {
		t.Fatal("in-flight request hidden", stats)
	}
	cancel()
	close(release)
	<-done
	if route := a.requestStats().Routes[8]; route.Canceled != 1 || route.Completed != 1 || route.Active != 0 {
		t.Fatal(route)
	}
	a.frontend = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("prefix")); panic(http.ErrAbortHandler) })
	func() {
		defer func() {
			if recover() != http.ErrAbortHandler {
				t.Fatal("stream abort suppressed")
			}
		}()
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/another-private-path", nil))
	}()
	if route := a.requestStats().Routes[8]; route.StreamAborts != 1 || route.Panics != 0 || route.Statuses[2] != 2 || route.WrittenBytes != 10 || route.Active != 0 {
		t.Fatal("stream abort looked complete", route)
	}
}
func TestObservedWriterPreservesCopyAndResponseController(t *testing.T) {
	writer := &observedWriter{ResponseWriter: httptest.NewRecorder()}
	n, e := io.Copy(writer, strings.NewReader("bytes"))
	if e != nil || n != 5 || writer.written != 5 || writer.status != 200 {
		t.Fatal(n, e, writer)
	}
	if e = http.NewResponseController(writer).Flush(); e != nil {
		t.Fatal("flush unwrap broken", e)
	}
}
func TestRequestTelemetryConcurrentCounters(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/healthz", nil))
			_ = a.requestStats()
		}()
	}
	group.Wait()
	route := a.requestStats().Routes[0]
	if route.Completed != 20 || route.Active != 0 {
		t.Fatal(route)
	}
}

type failingResponseWriter struct{ header http.Header }

func (w *failingResponseWriter) Header() http.Header       { return w.header }
func (w *failingResponseWriter) WriteHeader(int)           {}
func (w *failingResponseWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
func TestRequestTelemetryDeadlineWriteFailureAndUnwrittenPanic(t *testing.T) {
	a, h := telemetryAPI(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done(); w.WriteHeader(503) }))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// An already-expired caller deadline is distinct from explicit cancellation.
	deadlineCtx, deadlineCancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer deadlineCancel()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/deadline", nil).WithContext(deadlineCtx))
	if route := a.requestStats().Routes[8]; route.Deadlines != 1 || route.Canceled != 0 || route.Statuses[5] != 1 {
		t.Fatal("deadline conflated with cancellation", route)
	}
	a.frontend = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("failed")) })
	h.ServeHTTP(&failingResponseWriter{header: make(http.Header)}, httptest.NewRequest("GET", "/write-error", nil).WithContext(ctx))
	if route := a.requestStats().Routes[8]; route.WriteErrors != 1 || route.WrittenBytes != 0 || route.Canceled != 1 {
		t.Fatal("failed bytes counted as written", route)
	}
	a.frontend = http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("fixture panic") })
	func() {
		defer func() {
			if recover() != "fixture panic" {
				t.Fatal("unexpected panic behavior")
			}
		}()
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/panic", nil))
	}()
	if route := a.requestStats().Routes[8]; route.Panics != 1 || route.Statuses[0] != 1 || route.Completed != 3 || route.Active != 0 {
		t.Fatal("unwritten panic manufactured a response", route)
	}
}
