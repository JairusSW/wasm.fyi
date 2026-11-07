package api

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/artifactdb"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func (a *benchmarkAPI) EnableArtifacts(directory string) error {
	s, err := artifactdb.Open(filepath.Join(directory, "artifacts"))
	if err != nil {
		return err
	}
	if err = s.Prune(context.Background()); err != nil {
		s.Close()
		return err
	}
	a.artifacts = s
	ctx, cancel := context.WithCancel(context.Background())
	a.artifactCancel = cancel
	a.artifactDone = make(chan struct{})
	go func() {
		defer close(a.artifactDone)
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.Prune(ctx); err != nil && ctx.Err() == nil {
					fmt.Fprintf(os.Stderr, "artifact retention: %v\n", err)
				}
			}
		}
	}()
	return nil
}
func artifactWrite(r *http.Request) bool {
	return (r.URL.Path == "/api/artifacts" && r.Method == "POST") || (strings.HasPrefix(r.URL.Path, "/api/artifacts/") && r.Method == "PUT")
}
func (a *benchmarkAPI) artifactPublisher(r *http.Request) bool {
	return artifactWrite(r) && hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.token))
}
func artifactError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, artifactdb.ErrInvalid):
		benchmarkError(w, r, 400, "invalid_artifact", "invalid Wasm, SHA-256, contract or query")
	case errors.Is(err, os.ErrNotExist):
		benchmarkError(w, r, 404, "artifact_not_found", "artifact is unavailable or expired")
	default:
		var size *http.MaxBytesError
		if errors.As(err, &size) {
			benchmarkError(w, r, 413, "payload_too_large", "artifact exceeds byte limit")
		} else {
			benchmarkProblem(w, r, err)
		}
	}
}
func (a *benchmarkAPI) serveArtifacts(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.Path
	if path != "/api/artifacts" && !strings.HasPrefix(path, "/api/artifacts/") {
		return false
	}
	if a.artifacts == nil {
		benchmarkError(w, r, 404, "artifact_not_found", "artifact storage is not enabled")
		return true
	}
	if artifactWrite(r) && !a.artifactPublisher(r) {
		benchmarkError(w, r, 401, "unauthorized", "bearer token required")
		return true
	}
	if path == "/api/artifacts" {
		switch r.Method {
		case "GET":
			if !queryFields(w, r, "workload|prefix|sha256|cursor|limit") {
				return true
			}
			q := r.URL.Query()
			limit := 100
			var err error
			if q.Get("limit") != "" {
				limit, err = strconv.Atoi(q.Get("limit"))
				if err != nil {
					artifactError(w, r, artifactdb.ErrInvalid)
					return true
				}
			}
			page, err := a.artifacts.List(r.Context(), artifactdb.Query{Workload: q.Get("workload"), Prefix: q.Get("prefix"), SHA256: q.Get("sha256"), After: q.Get("cursor"), Limit: limit})
			if err != nil {
				artifactError(w, r, err)
			} else {
				w.Header().Set("Cache-Control", "no-cache")
				respond(w, r, 200, page, false)
			}
		case "POST":
			if !queryFields(w, r, "") {
				return true
			}
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
			var input struct {
				ContractSHA256 string          `json:"contractSha256"`
				Workload       json.RawMessage `json:"workload"`
			}
			decoder := json.NewDecoder(r.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&input); err != nil {
				benchmarkError(w, r, 400, "invalid_artifact", "invalid contract JSON")
				return true
			}
			var extra any
			if err := decoder.Decode(&extra); err != io.EOF {
				benchmarkError(w, r, 400, "invalid_artifact", "expected one JSON object")
				return true
			}
			if err := a.artifacts.Register(r.Context(), input.ContractSHA256, input.Workload); err != nil {
				artifactError(w, r, err)
			} else {
				respond(w, r, 201, map[string]bool{"stored": true}, false)
			}
		default:
			w.Header().Set("Allow", "GET, POST")
			benchmarkError(w, r, 405, "method_not_allowed", "method not allowed")
		}
		return true
	}
	filename := strings.TrimPrefix(path, "/api/artifacts/")
	hash := strings.TrimSuffix(filename, ".wasm")
	if filename != hash+".wasm" || !artifactdb.ValidHash(hash) {
		benchmarkError(w, r, 404, "artifact_not_found", "unknown artifact")
		return true
	}
	if !queryFields(w, r, "") {
		return true
	}
	switch r.Method {
	case "PUT":
		r.Body = http.MaxBytesReader(w, r.Body, artifactdb.MaxBytes)
		n, err := a.artifacts.Put(r.Context(), hash, r.Body)
		if err != nil {
			artifactError(w, r, err)
		} else {
			respond(w, r, 201, map[string]any{"sha256": hash, "bytes": n}, false)
		}
	case "GET", "HEAD":
		file, published, expires, err := a.artifacts.Download(r.Context(), hash)
		if err != nil {
			artifactError(w, r, err)
			return true
		}
		defer file.Close()
		w.Header().Set("Content-Type", "application/wasm")
		w.Header().Set("Content-Disposition", `attachment; filename="`+hash+`.wasm"`)
		w.Header().Set("ETag", `"`+hash+`"`)
		maxAge := max(0, int(time.Until(expires).Seconds()))
		w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d, immutable", min(86400, maxAge)))
		http.ServeContent(w, r, filename, published, file)
	default:
		w.Header().Set("Allow", "GET, HEAD, PUT")
		benchmarkError(w, r, 405, "method_not_allowed", "method not allowed")
	}
	return true
}
