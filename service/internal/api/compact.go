package api

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// BenchmarkStore is the storage boundary shared by migration and SQL serving.
type BenchmarkStore interface {
	Put(context.Context, benchdb.Capture) (string, error)
	Platforms(context.Context) (benchdb.Catalog, error)
	Page(context.Context, benchdb.Query) (benchdb.Page, error)
	Summary(context.Context) (benchdb.Summary, error)
}

type benchmarkAPI struct {
	responses      *publicResponseCache
	observer       *API
	db             BenchmarkStore
	token          string
	frontend       http.Handler
	limiter        *requestLimiter
	active, assets chan struct{}
}

func NewBenchmarks(db BenchmarkStore, token string, limits RequestLimits, frontend http.Handler) (http.Handler, error) {
	if db == nil || len(token) < 32 || !limits.valid() {
		return nil, wire.Invalid("invalid benchmark server configuration")
	}
	a := &benchmarkAPI{responses: newPublicResponseCache(), db: db, token: token, frontend: frontend, limiter: newRequestLimiter(limits), active: make(chan struct{}, 16), assets: make(chan struct{}, 64)}
	if host, ok := frontend.(interface {
		SetBootstrap(func(context.Context) ([]byte, error))
	}); ok {
		if revisions, ok := db.(interface {
			PublicRevision(context.Context) (string, error)
		}); ok {
			var mu sync.Mutex
			var revision string
			var data []byte
			var cachedAt time.Time
			host.SetBootstrap(func(ctx context.Context) ([]byte, error) {
				current, err := revisions.PublicRevision(ctx)
				if err != nil {
					return nil, err
				}
				mu.Lock()
				defer mu.Unlock()
				if data != nil && revision == current && time.Since(cachedAt) < 30*time.Second {
					return data, nil
				}
				summary, err := db.Summary(ctx)
				if err != nil {
					return nil, err
				}
				// encoding/json escapes HTML/script delimiters even in machine labels.
				encoded, err := json.Marshal(summary)
				if err != nil {
					return nil, err
				}
				if len(encoded) > 64<<10 {
					return nil, wire.Invalid("bootstrap exceeds byte limit")
				}
				data = encoded
				revision = summary.Revision
				cachedAt = time.Now()
				return data, nil
			})
		}
	}
	a.observer = &API{limiter: a.limiter, frontend: frontend, requestHandler: http.HandlerFunc(a.serveRequest)}
	return a, nil
}
func benchmarkError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	respond(w, r, status, map[string]any{"error": map[string]string{"code": code, "message": message}}, false)
}
func benchmarkProblem(w http.ResponseWriter, r *http.Request, e error) {
	status, code, message := 500, "internal_error", "internal service error"
	switch {
	case errors.Is(e, benchdb.ErrChanged):
		status, code, message = 409, "revision_changed", "results changed; restart pagination"
	case errors.Is(e, benchdb.ErrNotFound):
		status, code, message = 404, "platform_not_found", "unknown platform"
	case errors.Is(e, wire.ErrInvalid):
		status, code, message = 400, "invalid_request", e.Error()
	case errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded):
		status, code, message = 503, "request_timeout", "request canceled or timed out"
	default:
		var large *http.MaxBytesError
		if errors.As(e, &large) {
			status, code, message = 413, "payload_too_large", "capture exceeds 1 MiB"
		}
	}
	benchmarkError(w, r, status, code, message)
}
func method(w http.ResponseWriter, r *http.Request, allowed string) bool {
	if r.Method == allowed {
		return true
	}
	w.Header().Set("Allow", allowed)
	benchmarkError(w, r, 405, "method_not_allowed", "use "+allowed)
	return false
}
func queryFields(w http.ResponseWriter, r *http.Request, allowed string) bool {
	for key, values := range r.URL.Query() {
		if len(values) != 1 || !strings.Contains("|"+allowed+"|", "|"+key+"|") {
			benchmarkError(w, r, 400, "invalid_query", "unknown or repeated query parameter")
			return false
		}
	}
	return true
}
func (a *benchmarkAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) { a.observer.serve(w, r) }
func (a *benchmarkAPI) EnableDashboard(directory, listenAddress string) error {
	if err := a.observer.EnableDashboard(directory, listenAddress); err != nil {
		return err
	}
	if lookup, ok := a.db.(interface {
		AnalyticsSelectionKnown(context.Context, string, string) (bool, error)
	}); ok {
		a.observer.dashboard.analytics.SetSelectionLookup(lookup.AnalyticsSelectionKnown)
	}
	return nil
}
func (a *benchmarkAPI) Close() error { return a.observer.Close() }
func (a *benchmarkAPI) serveRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if a.frontend != nil && !strings.HasPrefix(r.URL.Path, "/api") && !strings.HasPrefix(r.URL.Path, "/admin") && r.URL.Path != "/healthz" && r.URL.Path != "/readyz" {
		select {
		case a.assets <- struct{}{}:
			defer func() { <-a.assets }()
		default:
			benchmarkError(w, r, 429, "asset_limit", "asset concurrency limit")
			return
		}
		a.frontend.ServeHTTP(w, r)
		return
	}
	publisher := r.URL.Path == "/api/captures" && r.Method == "POST" && hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.token))
	client, e := a.limiter.clientIdentity(r, publisher)
	if e != nil {
		benchmarkProblem(w, r, e)
		return
	}
	if ok, retry := a.limiter.allow(client, publisher, time.Now()); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		benchmarkError(w, r, 429, "rate_limit", "request rate limit")
		return
	}
	select {
	case a.active <- struct{}{}:
		defer func() { <-a.active }()
	default:
		benchmarkError(w, r, 429, "concurrency_limit", "request concurrency limit")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	a.cachedRead(w, r, a.serveData)
}
func (a *benchmarkAPI) serveData(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var e error
	publisher := r.URL.Path == "/api/captures" && r.Method == "POST" && hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.token))
	if a.serveSQL(w, r) {
		return
	}
	switch r.URL.Path {
	case "/api/summary":
		if !method(w, r, "GET") || !queryFields(w, r, "") {
			return
		}
		summary, e := a.db.Summary(ctx)
		if e != nil {
			benchmarkProblem(w, r, e)
			return
		}
		respond(w, r, 200, summary, false)
	case "/healthz":
		if !method(w, r, "GET") || !queryFields(w, r, "") {
			return
		}
		respond(w, r, 200, map[string]bool{"ready": true}, false)
	case "/api/platforms":
		if !method(w, r, "GET") || !queryFields(w, r, "") {
			return
		}
		catalog, e := a.db.Platforms(ctx)
		if e != nil {
			benchmarkProblem(w, r, e)
			return
		}
		respond(w, r, 200, catalog, false)
	case "/api/benchmarks", "/api/history":
		if !method(w, r, "GET") || !queryFields(w, r, "platform|phase|cursor|limit") {
			return
		}
		n := 200
		if value := r.URL.Query().Get("limit"); value != "" {
			n, e = strconv.Atoi(value)
			if e != nil || n < 1 || n > 1000 {
				benchmarkError(w, r, 400, "invalid_query", "limit must be 1–1000")
				return
			}
		}
		q := r.URL.Query()
		page, e := a.db.Page(ctx, benchdb.Query{History: r.URL.Path == "/api/history", Platform: q.Get("platform"), Phase: q.Get("phase"), Cursor: q.Get("cursor"), Limit: n})
		if e != nil {
			benchmarkProblem(w, r, e)
			return
		}
		respond(w, r, 200, page, false)
	case "/api/captures":
		if !method(w, r, "POST") {
			return
		}
		if !publisher {
			w.Header().Set("WWW-Authenticate", `Bearer realm="wasm.fyi"`)
			benchmarkError(w, r, 401, "unauthorized", "publisher token required")
			return
		}
		if !queryFields(w, r, "") {
			return
		}
		contentType, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if e != nil || contentType != "application/json" {
			benchmarkError(w, r, 415, "unsupported_media_type", "use application/json")
			return
		}
		var c benchdb.Capture
		if e = decode(w, r, &c); e != nil {
			benchmarkProblem(w, r, e)
			return
		}
		id, e := a.db.Put(ctx, c)
		if e != nil {
			benchmarkProblem(w, r, e)
			return
		}
		respond(w, r, 200, map[string]string{"id": id}, false)
	default:
		benchmarkError(w, r, 404, "not_found", "unknown endpoint")
	}
}

// ReadOnlyBenchmarks disables capture publication with the same error contract.
func ReadOnlyBenchmarks(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/captures" && r.Method == "POST" {
			benchmarkError(w, r, 403, "read_only", "capture publication is disabled")
			return
		}
		next.ServeHTTP(w, r)
	})
}
