// Package api serves bounded reads and authenticated publication, never benchmarks.
package api

import (
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type API struct {
	Store       *store.Store
	Token       string
	CursorKey   []byte
	active      chan struct{}
	limiter     *requestLimiter
	frontend    http.Handler
	cohorts     *cohortCache
	calculating chan struct{}
	results     *resultCache
	selecting   chan struct{}
	downloading chan struct{}
}

var errQueryBusy = errors.New("result query concurrency limit")

func New(s *store.Store, token string, key []byte) (http.Handler, error) {
	return NewWithRequestLimits(s, token, key, DefaultRequestLimits())
}
func NewWithRequestLimits(s *store.Store, token string, key []byte, limits RequestLimits) (http.Handler, error) {
	return NewWithFrontend(s, token, key, limits, nil)
}

// NewWithFrontend keeps static requests under the same bounded admission and
// shutdown leases as API requests. A nil frontend retains API-only behavior.
func NewWithFrontend(s *store.Store, token string, key []byte, limits RequestLimits, frontend http.Handler) (http.Handler, error) {
	if !limits.valid() {
		return nil, fmt.Errorf("invalid request limits")
	}

	if len(token) < 32 || len(key) < 32 {
		return nil, fmt.Errorf("admin token and at least 32 cursor-key bytes required")
	}
	a := &API{Store: s, Token: token, CursorKey: key, active: make(chan struct{}, 8), limiter: newRequestLimiter(limits), frontend: frontend}
	a.cohorts = &cohortCache{entries: map[string]*store.Cohort{}}
	a.calculating = make(chan struct{}, 2)
	a.results = &resultCache{entries: map[string]resultCacheEntry{}}
	a.selecting = make(chan struct{}, 2)
	a.downloading = make(chan struct{}, 2)
	return http.HandlerFunc(a.serve), nil
}

type cursor struct {
	Revision string `json:"revision"`
	Query    string `json:"query"`
	Offset   int    `json:"offset"`
}

func (a *API) sign(c cursor) string {
	b, _ := wire.Encode(c)
	mac := hmac.New(sha256.New, a.CursorKey)
	mac.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (a *API) parse(token string) (cursor, error) {
	var c cursor
	p := strings.Split(token, ".")
	if len(p) != 2 || len(token) > 2048 {
		return c, wire.Invalid("invalid cursor")
	}
	b, e := base64.RawURLEncoding.DecodeString(p[0])
	if e != nil {
		return c, wire.Invalid("invalid cursor")
	}
	sig, e := base64.RawURLEncoding.DecodeString(p[1])
	if e != nil {
		return c, wire.Invalid("invalid cursor")
	}
	mac := hmac.New(sha256.New, a.CursorKey)
	mac.Write(b)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return c, wire.Invalid("invalid cursor")
	}
	if e = json.Unmarshal(b, &c); e != nil || c.Offset < 0 || !wire.IsHash(c.Revision) {
		return c, wire.Invalid("invalid cursor")
	}
	return c, nil
}
func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		if fields[0] != "gzip" {
			continue
		}
		quality := 1.0
		for _, p := range fields[1:] {
			p = strings.TrimSpace(p)
			if strings.HasPrefix(p, "q=") {
				q, e := strconv.ParseFloat(p[2:], 64)
				if e != nil {
					quality = 0
				} else {
					quality = q
				}
			}
		}
		return quality > 0
	}
	return false
}
func respond(w http.ResponseWriter, r *http.Request, status int, v any, immutable bool) {
	b, e := wire.Encode(v)
	if e != nil || len(b) > wire.ResponseBytes {
		http.Error(w, "response exceeds byte limit; narrow the scope", 422)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Vary", "Accept-Encoding")
	encoding := "identity"
	if acceptsGzip(r.Header.Get("Accept-Encoding")) {
		encoding = "gzip"
	}
	etag := `"` + wire.Hash(append([]byte(encoding+":"), b...)) + `"`
	w.Header().Set("ETag", etag)
	if immutable {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	if r.Header.Get("If-None-Match") == etag && status == 200 {
		w.WriteHeader(304)
		return
	}
	if encoding == "gzip" {
		w.Header().Set("Content-Encoding", "gzip")
		w.WriteHeader(status)
		gz := gzip.NewWriter(w)
		defer gz.Close()
		_, _ = gz.Write(b)
	} else {
		w.WriteHeader(status)
		_, _ = w.Write(b)
	}
}
func problem(w http.ResponseWriter, r *http.Request, e error) {
	status := 500
	message := "internal service error"
	code := "internal_error"
	if errors.Is(e, store.ErrNotFound) {
		status = 404
		message = store.ErrNotFound.Error()
		code = "not_found"
	} else if errors.Is(e, store.ErrLimit) {
		status = 422
		message = store.ErrLimit.Error()
		code = "scope_limit"
	} else if errors.Is(e, store.ErrNeedsRestart) {
		status = 503
		message = store.ErrNeedsRestart.Error()
		code = "restart_required"
	} else if errors.Is(e, store.ErrConflict) {
		status = 409
		message = store.ErrConflict.Error()
		code = "immutable_conflict"
	} else if errors.Is(e, store.ErrQuota) {
		status = 507
		message = store.ErrQuota.Error()
		code = "storage_quota"
	} else if errors.Is(e, store.ErrUndeclared) {
		status = 403
		message = store.ErrUndeclared.Error()
		code = "undeclared_object"
	} else if errors.Is(e, wire.ErrInvalid) {
		status = 400
		message = "invalid request"
		code = "invalid_request"
	} else if errors.Is(e, context.DeadlineExceeded) || errors.Is(e, context.Canceled) {
		status = 503
		message = "request canceled or timed out"
		code = "query_timeout"
	} else {
		var tooLarge *http.MaxBytesError
		if errors.As(e, &tooLarge) {
			status = 413
			message = "request exceeds byte limit"
			code = "payload_too_large"
		}
	}
	respond(w, r, status, map[string]string{"error": message, "code": code}, false)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, wire.ResponseBytes)
	b, e := io.ReadAll(r.Body)
	if e != nil {
		return e
	}
	return wire.Decode(b, v)
}
func limit(r *http.Request) (int, error) {
	if r.URL.Query().Get("limit") == "" {
		return 100, nil
	}
	n, e := strconv.Atoi(r.URL.Query().Get("limit"))
	if e != nil || n < 1 || n > 1000 {
		return 0, wire.Invalid("invalid limit")
	}
	return n, nil
}
func (a *API) serve(w http.ResponseWriter, r *http.Request) {
	finish, e := a.Store.Lease()
	if e != nil {
		problem(w, r, e)
		return
	}
	defer finish()
	timeout := 15 * time.Second
	bulkPath := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/"), "/"), "/")
	bulk := strings.HasPrefix(r.URL.Path, "/api/v1/") && len(bulkPath) == 3 && bulkPath[0] == "files" && wire.IsHash(bulkPath[1]) && bulkPath[2] == "download" && (r.Method == "GET" || r.Method == "HEAD")
	if bulk {
		timeout = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	r = r.WithContext(ctx)
	publisher := strings.HasPrefix(r.URL.Path, "/admin/v1/") && hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.Token))
	client, e := a.limiter.clientIdentity(r, publisher)
	if e != nil {
		problem(w, r, e)
		return
	}
	if allowed, retry := a.limiter.allow(client, publisher, time.Now()); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		respond(w, r, 429, map[string]string{"error": "client request limit"}, false)
		return
	}
	select {
	case a.active <- struct{}{}:
		defer func() { <-a.active }()
	default:
		respond(w, r, 429, map[string]string{"error": "request concurrency limit"}, false)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
		if r.Method != "GET" {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(405)
			return
		}
		params, e := strictQuery(r.URL.RawQuery)
		if e == nil {
			e = allowedQuery(params)
		}
		if e != nil {
			problem(w, r, e)
			return
		}
		health := a.Store.Health()
		status := 200
		if r.URL.Path == "/readyz" && !health.Ready {
			status = 503
		}
		respond(w, r, status, health, false)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/admin/v1/") {
		a.admin(w, r)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/v1/") {
		if a.frontend != nil && !strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/admin/") && r.URL.Path != "/api" && r.URL.Path != "/admin" {
			a.frontend.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/"), "/")
	headParts := strings.Split(path, "/")
	fileHead := r.Method == "HEAD" && headParts[0] == "files" && (len(headParts) == 4 && headParts[2] == "chunks" || len(headParts) == 3 && headParts[2] == "download")
	if r.Method != "GET" && !fileHead {
		w.Header().Set("Allow", "GET")
		w.WriteHeader(405)
		return
	}
	params, e := strictQuery(r.URL.RawQuery)
	if e == nil {
		e = routeQuery(path, params)
	}
	if e != nil {
		problem(w, r, e)
		return
	}
	if path == "manifest" {
		respond(w, r, 200, map[string]any{"schema": 2, "revision": a.Store.Current(), "selectionAliases": map[string]string{"s1": "current", "s2": "previous"}, "limits": map[string]int{"defaultResults": 100, "maxResults": 1000, "decodedResponseBytes": wire.ResponseBytes, "decodedChunkBytes": wire.ChunkBytes, "scanKeys": store.ScanLimit, "decodedEvidenceResourceBytes": wire.ResourceBytes, "maxEvidenceFragments": wire.ResourceFragments, "nativeFunctionShards": 4096, "nativeFunctions": 1000000, "cohortScopeBytes": 4096, "cohortComputations": 2, "resultComputations": 2, "resultCacheBytes": resultCacheBytes, "resultCacheEntries": resultCacheEntries, "cohortCells": 100000, "reportFileDownloads": 2, "reportFileDownloadSeconds": 300, "reportFileChunkBytes": wire.ReportFileChunkBytes, "reportFileBytes": wire.ReportFileBytes}, "endpoints": []string{"overview", "results", "reports", "metrics", "methods", "configurations", "environments", "workloads", "artifacts", "history", "aggregates", "cohorts", "sessions", "files"}}, false)
		return
	}
	if path == "overview" || path == "aggregates" || strings.HasPrefix(path, "cohorts/") {
		a.cohort(w, r, path, params)
		return
	}
	n, e := limit(r)
	if e != nil {
		problem(w, r, e)
		return
	}
	c := cursor{}
	if token := params.Get("cursor"); token != "" {
		c, e = a.parse(token)
		if e != nil {
			problem(w, r, e)
			return
		}
	}
	revision := params.Get("revision")
	immutable := revision != ""
	if revision == "" {
		revision = c.Revision
	}
	if revision == "" {
		revision = a.Store.Current()
	}
	if _, e = a.Store.Revision(revision); e != nil {
		problem(w, r, e)
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) == 3 && parts[0] == "reports" && parts[2] == "files" {
		rows, e := a.Store.ReportFiles(r.Context(), revision, parts[1])
		if e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 200, map[string]any{"revision": revision, "items": rows, "nextCursor": "", "complete": true, "total": len(rows)}, immutable)
		return
	}
	if len(parts) == 3 && parts[0] == "artifacts" && parts[2] == "functions" {
		query := "artifact-functions:" + parts[1] + ":producer-order:" + strconv.Itoa(n)
		if c.Revision != "" && (c.Revision != revision || c.Query != query) {
			problem(w, r, wire.Invalid("cursor scope differs"))
			return
		}
		page, e := a.Store.FunctionPage(r.Context(), revision, parts[1], c.Offset, n)
		if e != nil {
			problem(w, r, e)
			return
		}
		next := ""
		if page.Next < page.Total {
			next = a.sign(cursor{revision, query, page.Next})
		}
		respond(w, r, 200, map[string]any{"revision": revision, "artifact": parts[1], "items": page.Items, "total": page.Total, "complete": page.Next == page.Total, "nextCursor": next, "order": "producer-order", "indexed": page.Indexed}, immutable)
		return
	}
	if parts[0] == "methods" && len(parts) == 2 {
		method, e := a.Store.MethodContext(r.Context(), revision, params.Get("definition"), parts[1])
		if e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 200, map[string]any{"revision": revision, "definition": params.Get("definition"), "id": parts[1], "method": method}, immutable)
		return
	}
	if parts[0] == "sessions" && len(parts) >= 2 {
		if len(parts) == 2 {
			v, e := a.Store.SessionInfo(r.Context(), revision, parts[1])
			if e != nil {
				problem(w, r, e)
				return
			}
			respond(w, r, 200, v, immutable)
			return
		}
		if len(parts) == 3 && parts[2] == "jobs" {
			query := "session-jobs:" + parts[1] + ":" + strconv.Itoa(n)
			if c.Revision != "" && (c.Revision != revision || c.Query != query) {
				problem(w, r, wire.Invalid("cursor scope differs"))
				return
			}
			page, e := a.Store.SessionJobs(r.Context(), revision, parts[1], c.Offset, n)
			if e != nil {
				problem(w, r, e)
				return
			}
			next := ""
			if page.Next < page.Total {
				next = a.sign(cursor{revision, query, page.Next})
			}
			respond(w, r, 200, map[string]any{"revision": revision, "items": page.Items, "total": page.Total, "complete": page.Next == page.Total, "nextCursor": next, "sort": "machine-corpus-attempt-id"}, immutable)
			return
		}
		http.NotFound(w, r)
		return
	}
	if parts[0] == "revisions" {
		if len(parts) == 2 {
			v, e := a.Store.Revision(parts[1])
			if e != nil {
				problem(w, r, e)
				return
			}
			respond(w, r, 200, map[string]any{"id": parts[1], "revision": v}, true)
			return
		}
		if len(parts) != 1 {
			http.NotFound(w, r)
			return
		}
		ids := []string{}
		for id := revision; id != ""; {
			if len(ids) >= store.ScanLimit {
				problem(w, r, store.ErrLimit)
				return
			}
			ids = append(ids, id)
			v, e := a.Store.Revision(id)
			if e != nil {
				problem(w, r, e)
				return
			}
			id = v.Parent
		}
		a.page(w, r, revision, "revisions:"+strconv.Itoa(n), ids, n, c, false)
		return
	}
	kinds := map[string]string{"reports": "report", "metrics": "metric", "configurations": "configuration", "tracks": "track", "environments": "environment", "workloads": "workload", "artifacts": "artifact", "files": "report-file", "results": "result"}
	if len(parts) == 3 && parts[0] == "files" && parts[2] == "download" {
		a.reportFileDownload(w, r, revision, parts[1])
		return
	}
	if len(parts) == 4 && parts[0] == "files" && parts[2] == "chunks" {
		for key, values := range params {
			if key != "revision" || len(values) != 1 {
				problem(w, r, wire.Invalid("unsupported file query"))
				return
			}
		}
		file, data, e := a.Store.ReportFileChunk(r.Context(), revision, parts[1], parts[3])
		if e != nil {
			problem(w, r, e)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+file.Name+`.part"`)
		w.Header().Set("ETag", `"`+parts[3]+`"`)
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		if r.Method != "HEAD" {
			_, _ = w.Write(data)
		}
		return
	}
	if kind, ok := kinds[parts[0]]; ok && len(parts) >= 2 {
		record, e := a.Store.Record(revision, kind, parts[1])
		if e != nil {
			problem(w, r, e)
			return
		}
		if kind == "artifact" && len(parts) == 3 && (parts[2] == "bytes" || parts[2] == "content") {
			for key, values := range params {
				if (key != "revision" && key != "download" && key != "offset" && key != "length") || len(values) != 1 {
					problem(w, r, wire.Invalid("unsupported byte query"))
					return
				}
			}
			download := params.Get("download") == "1"
			if params.Get("download") != "" && !download || download && (params.Has("offset") || params.Has("length")) {
				problem(w, r, wire.Invalid("invalid download query"))
				return
			}
			artifact, data, e := a.Store.ArtifactBytes(r.Context(), revision, parts[1])
			if e != nil {
				problem(w, r, e)
				return
			}
			offset, length := 0, len(data)
			if !download {
				length = min(length, wire.ResponseBytes)
				if params.Has("offset") {
					offset, e = strconv.Atoi(params.Get("offset"))
					if e != nil || offset < 0 || offset > len(data) {
						problem(w, r, wire.Invalid("invalid byte offset"))
						return
					}
				}
				length = min(length, len(data)-offset)
				if params.Has("length") {
					length, e = strconv.Atoi(params.Get("length"))
					if e != nil || length < 0 || length > wire.ResponseBytes || length > len(data)-offset {
						problem(w, r, wire.Invalid("invalid byte length"))
						return
					}
				}
			}
			if header := r.Header.Get("Range"); header != "" {
				if len(r.Header.Values("Range")) != 1 || download || params.Has("offset") || params.Has("length") {
					problem(w, r, wire.Invalid("ambiguous range request"))
					return
				}
				var valid bool
				offset, length, valid = nativeRange(header, len(data))
				if !valid {
					w.Header().Set("Content-Range", "bytes */"+strconv.Itoa(len(data)))
					w.WriteHeader(416)
					return
				}
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Length", strconv.Itoa(length))
			w.Header().Set("ETag", `"`+artifact.Content.SHA256+":"+strconv.Itoa(offset)+":"+strconv.Itoa(length)+`"`)
			if immutable {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			w.Header().Set("X-Content-SHA256", artifact.Content.SHA256)
			if download {
				w.Header().Set("Content-Disposition", `attachment; filename="`+artifact.Content.SHA256+`.bin"`)
			}
			if r.Header.Get("If-None-Match") == w.Header().Get("ETag") {
				w.Header().Del("Content-Length")
				w.WriteHeader(304)
				return
			}
			if !download && length > 0 {
				w.Header().Set("Content-Range", "bytes "+strconv.Itoa(offset)+"-"+strconv.Itoa(offset+length-1)+"/"+strconv.Itoa(len(data)))
				w.WriteHeader(206)
			} else {
				w.WriteHeader(200)
			}
			_, _ = w.Write(data[offset : offset+length])
			return
		}
		if kind == "artifact" && len(parts) == 3 && parts[2] == "inspection" {
			for key, values := range params {
				if (key != "revision" && key != "chunk") || len(values) != 1 {
					problem(w, r, wire.Invalid("unsupported inspection query"))
					return
				}
			}
			var artifact wire.Artifact
			artifact, e = wire.ArtifactData(record.Data)
			if e != nil {
				problem(w, r, e)
				return
			}
			digest := params.Get("chunk")
			if digest == "" {
				digest = artifact.Inspection.Metadata
			}
			if digest == "" {
				problem(w, r, store.ErrNotFound)
				return
			}
			b, e := a.Store.ArtifactEvidence(r.Context(), revision, parts[1], digest)
			if e != nil {
				problem(w, r, e)
				return
			}
			respond(w, r, 200, json.RawMessage(b), immutable)
			return
		}
		if len(parts) == 2 {
			respond(w, r, 200, map[string]any{"revision": revision, "record": record}, immutable)
			return
		}
		if len(parts) == 3 && ((kind == "result" && parts[2] == "samples") || (kind == "report" && parts[2] == "evidence")) {
			for key, values := range params {
				if (key != "revision" && key != "chunk") || len(values) != 1 {
					problem(w, r, wire.Invalid("unsupported evidence query"))
					return
				}
			}
			var v struct {
				Evidence     []string `json:"evidence"`
				PassContexts []string `json:"passContexts"`
			}
			if e = json.Unmarshal(record.Data, &v); e != nil {
				problem(w, r, e)
				return
			}
			if digest := params.Get("chunk"); digest != "" {
				var b []byte
				if kind == "report" {
					b, e = a.Store.ReportEvidenceContext(r.Context(), revision, parts[1], digest)
				} else {
					b, e = a.Store.EvidenceContext(r.Context(), revision, parts[1], digest)
				}
				if e != nil {
					problem(w, r, e)
					return
				}
				respond(w, r, 200, json.RawMessage(b), immutable)
			} else {
				roots := append(v.Evidence, v.PassContexts...)
				if kind == "report" {
					report, err := wire.ReportEvidenceData(record.Data)
					if err != nil {
						problem(w, r, err)
						return
					}
					roots = report.Roots()
				}
				respond(w, r, 200, map[string]any{"revision": revision, "chunks": roots}, immutable)
			}
			return
		}
		http.NotFound(w, r)
		return
	}
	if path == "results" || path == "history" {
		allowed := map[string]bool{}
		for _, k := range []string{"revision", "selection", "environment", "runtime", "track", "definition", "method", "configuration", "contract", "workload", "metric", "scenario", "profile", "statistic", "sort", "limit", "cursor", "from", "until"} {
			allowed[k] = true
		}
		for k, v := range params {
			if !allowed[k] || len(v) != 1 {
				problem(w, r, wire.Invalid("unsupported query"))
				return
			}
		}
		selection := params.Get("selection")
		if selection == "" || selection == "s1" {
			selection = "current"
		}
		if selection == "s2" {
			selection = "previous"
		}
		if selection != "current" && selection != "previous" {
			problem(w, r, wire.Invalid("unsupported selection"))
			return
		}
		sortOrder := params.Get("sort")
		if sortOrder == "" {
			sortOrder = "catalog"
		}
		if sortOrder != "catalog" && sortOrder != "value" && sortOrder != "-value" {
			problem(w, r, wire.Invalid("unsupported sort"))
			return
		}
		q := store.Query{Revision: revision, Selection: selection, Environment: params.Get("environment"), Runtime: params.Get("runtime"), Track: params.Get("track"), Definition: params.Get("definition"), Method: params.Get("method"), Configuration: params.Get("configuration"), Contract: params.Get("contract"), Workload: params.Get("workload"), Metric: params.Get("metric"), Scenario: params.Get("scenario"), Profile: params.Get("profile"), Statistic: params.Get("statistic"), Sort: sortOrder, Limit: n, From: params.Get("from"), Until: params.Get("until")}
		if path == "history" {
			q, e = store.NormalizeHistoryQuery(q)
			if e != nil {
				problem(w, r, e)
				return
			}
		}
		qb, _ := wire.Encode(q)
		queryHash := wire.Hash(append([]byte(path+":"), qb...))
		if c.Revision != "" && (c.Revision != revision || c.Query != queryHash) {
			problem(w, r, wire.Invalid("cursor scope differs"))
			return
		}
		rows, e := a.resultRows(r.Context(), q, path == "history")
		if e != nil {
			if errors.Is(e, errQueryBusy) {
				respond(w, r, 429, map[string]string{"error": e.Error()}, false)
				return
			}
			problem(w, r, e)
			return
		}
		a.resultPage(w, r, revision, queryHash, rows, n, c, immutable)
		return
	}
	if kind, ok := kinds[path]; ok && kind != "result" {
		for k, v := range params {
			if (k != "revision" && k != "limit" && k != "cursor") || len(v) != 1 {
				problem(w, r, wire.Invalid("unsupported query"))
				return
			}
		}
		query := path + ":" + strconv.Itoa(n)
		if c.Revision != "" && (c.Revision != revision || c.Query != query) {
			problem(w, r, wire.Invalid("cursor scope differs"))
			return
		}
		p, e := a.Store.CatalogPage(r.Context(), revision, kind, c.Offset, n)
		if e != nil {
			problem(w, r, e)
			return
		}
		next := ""
		if p.Next < p.Total {
			next = a.sign(cursor{revision, query, p.Next})
		}
		respond(w, r, 200, map[string]any{"revision": revision, "items": p.Items, "nextCursor": next, "complete": p.Next == p.Total, "total": p.Total}, immutable)
		return
	}
	http.NotFound(w, r)
}
func (a *API) page(w http.ResponseWriter, r *http.Request, revision, query string, rows any, n int, c cursor, immutable bool) {
	if c.Revision != "" && (c.Revision != revision || c.Query != query) {
		problem(w, r, wire.Invalid("cursor scope differs"))
		return
	}
	b, _ := wire.Encode(rows)
	var list []json.RawMessage
	_ = json.Unmarshal(b, &list)
	if c.Offset > len(list) {
		problem(w, r, wire.Invalid("cursor offset invalid"))
		return
	}
	end := c.Offset + n
	if end > len(list) {
		end = len(list)
	}
	for {
		next := ""
		if end < len(list) {
			next = a.sign(cursor{revision, query, end})
		}
		v := map[string]any{"revision": revision, "items": list[c.Offset:end], "nextCursor": next, "complete": end == len(list), "total": len(list)}
		b, _ := wire.Encode(v)
		if len(b) <= wire.ResponseBytes {
			respond(w, r, 200, v, immutable)
			return
		}
		end--
		if end <= c.Offset {
			problem(w, r, store.ErrLimit)
			return
		}
	}
}
func (a *API) admin(w http.ResponseWriter, r *http.Request) {
	if !hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.Token)) {
		respond(w, r, 401, map[string]string{"error": "unauthorized"}, false)
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/admin/v1/"), "/"), "/")
	params, e := strictQuery(r.URL.RawQuery)
	if e == nil && len(parts) == 3 && parts[0] == "imports" && parts[2] == "missing" {
		e = allowedQuery(params, "offset")
	} else if e == nil {
		e = allowedQuery(params)
	}
	if e != nil {
		problem(w, r, e)
		return
	}

	if len(parts) == 1 && parts[0] == "metrics" && r.Method == "GET" {
		stats, e := a.Store.Stats()
		if e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 200, stats, false)
		return
	}
	if len(parts) == 2 && parts[0] == "objects" && r.Method == "PUT" {
		r.Body = http.MaxBytesReader(w, r.Body, wire.BlobBytes)
		if e := a.Store.InstallDeclared(parts[1], r.Body); e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 201, map[string]string{"sha256": parts[1]}, false)
		return
	}
	if len(parts) == 2 && parts[0] == "imports" && r.Method == "GET" {
		status, e := a.Store.ImportStatus(parts[1])
		if e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 200, status, false)
		return
	}
	if len(parts) == 4 && parts[0] == "imports" && parts[2] == "inventories" && r.Method == "POST" {
		if e := a.Store.AttachInventoryContext(r.Context(), parts[1], parts[3]); e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 200, map[string]string{"id": parts[1], "inventory": parts[3]}, false)
		return
	}
	if len(parts) == 3 && parts[0] == "imports" && parts[2] == "abort" && r.Method == "POST" {
		if e := a.Store.Abort(parts[1]); e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 200, map[string]string{"id": parts[1], "state": "aborted"}, false)
		return
	}
	if len(parts) == 1 && parts[0] == "imports" && r.Method == "POST" {
		var j wire.Job
		if e := decode(w, r, &j); e != nil {
			problem(w, r, e)
			return
		}
		id, e := a.Store.Submit(j)
		if e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 201, map[string]string{"id": id}, false)
		return
	}
	if len(parts) == 3 && parts[0] == "imports" {
		if parts[2] == "missing" && r.Method == "GET" {
			items, e := a.Store.MissingContext(r.Context(), parts[1])
			if e != nil {
				problem(w, r, e)
				return
			}
			offset := 0
			if params.Get("offset") != "" {
				offset, e = strconv.Atoi(params.Get("offset"))
				if e != nil || offset < 0 || offset > len(items) {
					problem(w, r, wire.Invalid("invalid offset"))
					return
				}
			}
			end := offset + 100
			if end > len(items) {
				end = len(items)
			}
			respond(w, r, 200, map[string]any{"items": items[offset:end], "nextOffset": end, "complete": end == len(items)}, false)
			return
		}
		if parts[2] == "commit" && r.Method == "POST" {
			revision, e := a.Store.CommitContext(r.Context(), parts[1])
			if e != nil {
				problem(w, r, e)
				return
			}
			respond(w, r, 200, map[string]string{"revision": revision}, false)
			return
		}
	}
	http.NotFound(w, r)
}

func nativeRange(header string, size int) (int, int, bool) {
	if !strings.HasPrefix(header, "bytes=") || strings.Contains(header, ",") {
		return 0, 0, false
	}
	parts := strings.Split(strings.TrimPrefix(header, "bytes="), "-")
	if len(parts) != 2 || size == 0 {
		return 0, 0, false
	}
	start, end := 0, size-1
	var err error
	if parts[0] == "" {
		length, e := strconv.Atoi(parts[1])
		if e != nil || length <= 0 || length > wire.ResponseBytes {
			return 0, 0, false
		}
		start = max(0, size-length)
	} else {
		start, err = strconv.Atoi(parts[0])
		if err != nil || start < 0 || start >= size {
			return 0, 0, false
		}
		if parts[1] != "" {
			end, err = strconv.Atoi(parts[1])
			if err != nil || end < start {
				return 0, 0, false
			}
			end = min(end, size-1)
		}
	}
	length := end - start + 1
	if length < 1 || length > wire.ResponseBytes {
		return 0, 0, false
	}
	return start, length, true
}
