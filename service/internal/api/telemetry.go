package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/analytics"
)

var requestClasses = [...]string{"probe", "admin-import", "admin-upload", "admin-plan", "admin-progress", "admin-other", "summary", "evidence", "frontend", "other", "dashboard-analytics", "dashboard-auth", "page-event"}
var latencyBounds = [...]time.Duration{5 * time.Millisecond, 25 * time.Millisecond, 100 * time.Millisecond, 500 * time.Millisecond, 2500 * time.Millisecond, 15 * time.Second, 300 * time.Second}

type requestCounters struct {
	active       atomic.Int64
	completed    atomic.Uint64
	statuses     [6]atomic.Uint64
	latency      [8]atomic.Uint64
	bytes        atomic.Uint64
	decoded      atomic.Uint64
	canceled     atomic.Uint64
	deadlines    atomic.Uint64
	writeErrors  atomic.Uint64
	streamAborts atomic.Uint64
	panics       atomic.Uint64
}
type requestTelemetry struct {
	started atomic.Pointer[time.Time]
	routes  [len(requestClasses)]requestCounters
}
type RequestRouteStats struct {
	Class            string    `json:"class"`
	Active           int64     `json:"active"`
	Completed        uint64    `json:"completed"`
	Statuses         [6]uint64 `json:"statuses"`
	Latency          [8]uint64 `json:"latency"`
	WrittenBytes     uint64    `json:"writtenBytes"`
	DecodedJSONBytes uint64    `json:"decodedJSONBytes"`
	Canceled         uint64    `json:"canceled"`
	Deadlines        uint64    `json:"deadlines"`
	WriteErrors      uint64    `json:"writeErrors"`
	StreamAborts     uint64    `json:"streamAborts"`
	Panics           uint64    `json:"panics"`
}
type RequestStats struct {
	Caches               []CacheStats        `json:"caches"`
	StartedAt            *time.Time          `json:"startedAt"`
	Version              string              `json:"version"`
	LatencyUpperBoundsMS [7]int64            `json:"latencyUpperBoundsMs"`
	Routes               []RequestRouteStats `json:"routes"`
	Admission            AdmissionStats      `json:"admission"`
}
type AdmissionStats struct {
	Requests  int `json:"requests"`
	Results   int `json:"results"`
	Cohorts   int `json:"cohorts"`
	Downloads int `json:"downloads"`
}

func (a *API) requestStats() RequestStats {
	out := RequestStats{Caches: []CacheStats{a.results.stats(), a.cohorts.stats()}, StartedAt: a.requests.started.Load(), Version: "http-requests-v1", Routes: make([]RequestRouteStats, 0, len(requestClasses)), Admission: AdmissionStats{len(a.active), len(a.selecting), len(a.calculating), len(a.downloading)}}
	for i, b := range latencyBounds {
		out.LatencyUpperBoundsMS[i] = b.Milliseconds()
	}
	for i, label := range requestClasses {
		c := &a.requests.routes[i]
		v := RequestRouteStats{Class: label, Active: c.active.Load(), Completed: c.completed.Load(), WrittenBytes: c.bytes.Load(), DecodedJSONBytes: c.decoded.Load(), Canceled: c.canceled.Load(), Deadlines: c.deadlines.Load(), WriteErrors: c.writeErrors.Load(), StreamAborts: c.streamAborts.Load(), Panics: c.panics.Load()}
		for j := range v.Statuses {
			v.Statuses[j] = c.statuses[j].Load()
		}
		for j := range v.Latency {
			v.Latency[j] = c.latency[j].Load()
		}
		out.Routes = append(out.Routes, v)
	}
	return out
}
func requestClass(path string) int {
	path = strings.TrimSuffix(path, "/")
	if strings.HasPrefix(path, "/api/admin/") {
		return 10
	}
	if strings.HasPrefix(path, "/auth/") {
		return 11
	}
	if path == "/api/event" {
		return 12
	}
	if path == "/healthz" || path == "/readyz" {
		return 0
	}
	if strings.HasPrefix(path, "/admin/v1/") {
		segment, _, _ := strings.Cut(strings.TrimPrefix(path, "/admin/v1/"), "/")
		switch segment {
		case "imports":
			return 1
		case "objects":
			return 2
		case "plans":
			return 3
		case "progress":
			return 4
		default:
			return 5
		}
	}
	if strings.HasPrefix(path, "/api/v1/") {
		segment, rest, _ := strings.Cut(strings.TrimPrefix(path, "/api/v1/"), "/")
		switch segment {
		case "files", "archives":
			return 7
		case "artifacts", "reports", "results":
			if strings.Contains(rest, "/") {
				return 7
			}
		}
		return 6
	}
	if path == "/api" || path == "/admin" || strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/admin/") {
		return 9
	}
	return 8
}

type observedWriter struct {
	http.ResponseWriter
	status       int
	written      uint64
	decoded      uint64
	writeError   bool
	contextError error
}

func (w *observedWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *observedWriter) WriteHeader(status int) {
	if status >= 100 && status < 200 && status != 101 {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *observedWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	n, e := w.ResponseWriter.Write(b)
	w.written += uint64(n)
	if e != nil {
		w.writeError = true
	}
	return n, e
}
func (w *observedWriter) ReadFrom(reader io.Reader) (int64, error) {
	if from, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		if w.status == 0 {
			w.WriteHeader(200)
		}
		n, e := from.ReadFrom(reader)
		w.written += uint64(n)
		if e != nil {
			w.writeError = true
		}
		return n, e
	}
	return io.Copy(struct{ io.Writer }{w}, reader)
}

func (w *observedWriter) FlushError() error {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	e := http.NewResponseController(w.ResponseWriter).Flush()
	if e != nil {
		w.writeError = true
	}
	return e
}
func (w *observedWriter) Flush()            { _ = w.FlushError() }
func (w *observedWriter) decodedJSON(n int) { w.decoded += uint64(n) }

type countedRequestBody struct {
	io.ReadCloser
	read int64
}

func (b *countedRequestBody) Read(p []byte) (int, error) {
	n, e := b.ReadCloser.Read(p)
	b.read += int64(n)
	return n, e
}

func (a *API) serve(w http.ResponseWriter, r *http.Request) {
	var body *countedRequestBody
	if r.Body != nil {
		body = &countedRequestBody{ReadCloser: r.Body}
		r.Body = body
	}
	if a.requests.started.Load() == nil {
		now := time.Now().UTC()
		a.requests.started.CompareAndSwap(nil, &now)
	}
	index := requestClass(r.URL.Path)
	if index == 8 && a.frontend == nil {
		index = 9
	}
	c := &a.requests.routes[index]
	c.active.Add(1)
	observed := &observedWriter{ResponseWriter: w}
	started := time.Now()
	defer func() {
		recovered := recover()
		status := observed.status
		if status == 0 {
			status = 200
			if recovered != nil {
				status = 0
			}
		}
		bucket := status / 100
		if bucket < 0 || bucket > 5 {
			bucket = 0
		}
		c.statuses[bucket].Add(1)
		c.completed.Add(1)
		c.bytes.Add(observed.written)
		c.decoded.Add(observed.decoded)
		latency := time.Since(started)
		i := 0
		for i < len(latencyBounds) && latency > latencyBounds[i] {
			i++
		}
		c.latency[i].Add(1)
		if errors.Is(observed.contextError, context.Canceled) || errors.Is(r.Context().Err(), context.Canceled) {
			c.canceled.Add(1)
		}
		if errors.Is(observed.contextError, context.DeadlineExceeded) || errors.Is(r.Context().Err(), context.DeadlineExceeded) {
			c.deadlines.Add(1)
		}
		if observed.writeError {
			c.writeErrors.Add(1)
		}
		if recovered == http.ErrAbortHandler {
			c.streamAborts.Add(1)
		} else if recovered != nil {
			c.panics.Add(1)
		}
		c.active.Add(-1)
		if a.dashboard != nil && !strings.HasPrefix(r.URL.Path, "/api/admin/") && !strings.HasPrefix(r.URL.Path, "/auth/") && r.URL.Path != "/healthz" && r.URL.Path != "/readyz" && strings.TrimSuffix(r.URL.Path, "/") != "/api/event" {
			up := int64(0)
			if body != nil {
				up = body.read
			}
			finished := time.Now()
			event := analytics.Event{At: finished, Status: status, Method: r.Method, Path: analytics.CleanPath(r.URL.Path), Down: int64(observed.written), Up: up, MS: float64(latency) / float64(time.Millisecond)}
			// Honor privacy opt-outs for visitor/page/client analytics; byte accounting
			// is aggregate operational telemetry without any identity or dimensions.
			if r.Header.Get("DNT") != "1" && r.Header.Get("Sec-GPC") != "1" {
				event.API = strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/data/")
				if event.API {
					ip, err := a.limiter.clientIdentity(r, false)
					if err == nil {
						event.Agent, event.Browser, _ = analytics.Family(r.UserAgent())
						event.Origin = analytics.Classify(a.dashboard.origin, r.Header.Get("Sec-Fetch-Site"), r.Header.Get("Origin"), r.Header.Get("Referer"), r.UserAgent())
						if event.Origin == 0 {
							event.ID = a.dashboard.analytics.Identity(finished, ip, event.Agent)
						}
						event.Runtime = boundedAnalyticsSelection(r.URL.Query().Get("engine"))
						event.Workload = boundedAnalyticsSelection(r.URL.Query().Get("workload"))
						a.dashboard.analytics.Enqueue(analytics.Input{Event: event, IP: ip})
					} else {
						a.dashboard.analytics.Enqueue(analytics.Input{Event: analytics.Event{At: finished, APIBytes: strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/data/"), Down: int64(observed.written), Up: up}})
					}
				} else {
					a.dashboard.analytics.Enqueue(analytics.Input{Event: event})
				}
			} else {
				a.dashboard.analytics.Enqueue(analytics.Input{Event: analytics.Event{At: finished, APIBytes: strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/data/"), Down: int64(observed.written), Up: up}})
			}
		}
		if recovered != nil {
			panic(recovered)
		}
	}()
	if a.requestHandler != nil {
		if !a.dashboardRequest(observed, r) {
			a.requestHandler.ServeHTTP(observed, r)
		}
	} else {
		a.serveRequest(observed, r)
	}
}

func boundedAnalyticsSelection(v string) string {
	if len(v) > 80 {
		return ""
	}
	for _, r := range v {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("/-_.", r)) {
			return ""
		}
	}
	return v
}
