// Package api serves bounded reads and authenticated publication, never benchmarks.
package api

import (
	"compress/gzip"
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

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type API struct {
	Store     *store.Store
	Token     string
	CursorKey []byte
	active    chan struct{}
}

func New(s *store.Store, token string, key []byte) (http.Handler, error) {
	if token == "" || len(key) < 32 {
		return nil, fmt.Errorf("admin token and at least 32 cursor-key bytes required")
	}
	a := &API{Store: s, Token: token, CursorKey: key, active: make(chan struct{}, 8)}
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
		return c, fmt.Errorf("invalid cursor")
	}
	b, e := base64.RawURLEncoding.DecodeString(p[0])
	if e != nil {
		return c, fmt.Errorf("invalid cursor")
	}
	sig, e := base64.RawURLEncoding.DecodeString(p[1])
	if e != nil {
		return c, fmt.Errorf("invalid cursor")
	}
	mac := hmac.New(sha256.New, a.CursorKey)
	mac.Write(b)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return c, fmt.Errorf("invalid cursor")
	}
	if e = json.Unmarshal(b, &c); e != nil || c.Offset < 0 || !wire.IsHash(c.Revision) {
		return c, fmt.Errorf("invalid cursor")
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
	status := 400
	message := "invalid request"
	if errors.Is(e, store.ErrNotFound) {
		status = 404
		message = e.Error()
	} else if errors.Is(e, store.ErrLimit) {
		status = 422
		message = e.Error()
	} else if errors.Is(e, store.ErrNeedsRestart) {
		status = 503
		message = e.Error()
	}
	respond(w, r, status, map[string]string{"error": message}, false)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, wire.ResponseBytes)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	if e := d.Decode(new(any)); e != io.EOF {
		return fmt.Errorf("trailing input")
	}
	return nil
}
func limit(r *http.Request) (int, error) {
	if r.URL.Query().Get("limit") == "" {
		return 100, nil
	}
	n, e := strconv.Atoi(r.URL.Query().Get("limit"))
	if e != nil || n < 1 || n > 1000 {
		return 0, fmt.Errorf("invalid limit")
	}
	return n, nil
}
func (a *API) serve(w http.ResponseWriter, r *http.Request) {
	select {
	case a.active <- struct{}{}:
		defer func() { <-a.active }()
	default:
		respond(w, r, 429, map[string]string{"error": "request concurrency limit"}, false)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if strings.HasPrefix(r.URL.Path, "/admin/v1/") {
		a.admin(w, r)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/v1/") {
		http.NotFound(w, r)
		return
	}
	if r.Method != "GET" {
		w.Header().Set("Allow", "GET")
		w.WriteHeader(405)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/"), "/")
	if path == "manifest" {
		respond(w, r, 200, map[string]any{"schema": 2, "revision": a.Store.Current(), "selectionAliases": map[string]string{"s1": "current", "s2": "previous"}, "limits": map[string]int{"defaultResults": 100, "maxResults": 1000, "decodedResponseBytes": wire.ResponseBytes, "decodedChunkBytes": wire.ChunkBytes, "scanKeys": store.ScanLimit}, "endpoints": []string{"results", "reports", "metrics", "configurations", "environments", "workloads", "artifacts", "history"}}, false)
		return
	}
	n, e := limit(r)
	if e != nil {
		problem(w, r, e)
		return
	}
	params := r.URL.Query()
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
		a.page(w, r, revision, "revisions", ids, n, c, false)
		return
	}
	kinds := map[string]string{"reports": "report", "metrics": "metric", "configurations": "configuration", "tracks": "track", "environments": "environment", "workloads": "workload", "artifacts": "artifact", "results": "result"}
	if kind, ok := kinds[parts[0]]; ok && len(parts) >= 2 {
		record, e := a.Store.Record(revision, kind, parts[1])
		if e != nil {
			problem(w, r, e)
			return
		}
		if len(parts) == 2 {
			respond(w, r, 200, map[string]any{"revision": revision, "record": record}, immutable)
			return
		}
		if kind == "result" && len(parts) == 3 && parts[2] == "samples" {
			var v wire.Result
			if e = json.Unmarshal(record.Data, &v); e != nil {
				problem(w, r, e)
				return
			}
			if digest := params.Get("chunk"); digest != "" {
				b, e := a.Store.Evidence(revision, parts[1], digest)
				if e != nil {
					problem(w, r, e)
					return
				}
				respond(w, r, 200, json.RawMessage(b), immutable)
			} else {
				respond(w, r, 200, map[string]any{"revision": revision, "chunks": v.Evidence}, immutable)
			}
			return
		}
		http.NotFound(w, r)
		return
	}
	if path == "results" || path == "history" {
		allowed := map[string]bool{}
		for _, k := range []string{"revision", "selection", "environment", "runtime", "configuration", "contract", "workload", "metric", "scenario", "profile", "statistic", "sort", "limit", "cursor"} {
			allowed[k] = true
		}
		for k, v := range params {
			if !allowed[k] || len(v) != 1 {
				problem(w, r, fmt.Errorf("unsupported query"))
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
			problem(w, r, fmt.Errorf("unsupported selection"))
			return
		}
		sortOrder := params.Get("sort")
		if sortOrder == "" {
			sortOrder = "catalog"
		}
		if sortOrder != "catalog" && sortOrder != "value" && sortOrder != "-value" {
			problem(w, r, fmt.Errorf("unsupported sort"))
			return
		}
		q := store.Query{Revision: revision, Selection: selection, Environment: params.Get("environment"), Runtime: params.Get("runtime"), Configuration: params.Get("configuration"), Contract: params.Get("contract"), Workload: params.Get("workload"), Metric: params.Get("metric"), Scenario: params.Get("scenario"), Profile: params.Get("profile"), Statistic: params.Get("statistic"), Sort: sortOrder, Limit: n}
		qb, _ := wire.Encode(q)
		queryHash := wire.Hash(append([]byte(path+":"), qb...))
		rows, e := a.Store.Results(q, path == "history")
		if e != nil {
			problem(w, r, e)
			return
		}
		a.page(w, r, revision, queryHash, rows, n, c, immutable)
		return
	}
	if kind, ok := kinds[path]; ok && kind != "result" {
		for k, v := range params {
			if (k != "revision" && k != "limit" && k != "cursor") || len(v) != 1 {
				problem(w, r, fmt.Errorf("unsupported query"))
				return
			}
		}
		rows, e := a.Store.Catalog(revision, kind)
		if e != nil {
			problem(w, r, e)
			return
		}
		a.page(w, r, revision, path+":"+strconv.Itoa(n), rows, n, c, immutable)
		return
	}
	http.NotFound(w, r)
}
func (a *API) page(w http.ResponseWriter, r *http.Request, revision, query string, rows any, n int, c cursor, immutable bool) {
	if c.Revision != "" && (c.Revision != revision || c.Query != query) {
		problem(w, r, fmt.Errorf("cursor scope differs"))
		return
	}
	b, _ := wire.Encode(rows)
	var list []json.RawMessage
	_ = json.Unmarshal(b, &list)
	if c.Offset > len(list) {
		problem(w, r, fmt.Errorf("cursor offset invalid"))
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
	if len(parts) == 2 && parts[0] == "objects" && r.Method == "PUT" {
		r.Body = http.MaxBytesReader(w, r.Body, wire.ChunkBytes)
		if e := a.Store.Install(parts[1], r.Body); e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 201, map[string]string{"sha256": parts[1]}, false)
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
			items, e := a.Store.Missing(parts[1])
			if e != nil {
				problem(w, r, e)
				return
			}
			offset := 0
			if r.URL.Query().Get("offset") != "" {
				offset, e = strconv.Atoi(r.URL.Query().Get("offset"))
				if e != nil || offset < 0 || offset > len(items) {
					problem(w, r, fmt.Errorf("invalid offset"))
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
			revision, e := a.Store.Commit(parts[1])
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
