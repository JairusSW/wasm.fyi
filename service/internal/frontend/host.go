// Package frontend serves a fixed application build alongside live API data.
package frontend

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxAssetBytes = 64 << 20
const MaxShellBytes = 2 << 20

type WorkloadLookup func(context.Context, string) (bool, error)

type Host struct {
	root          *os.Root
	shell         []byte
	etag          string
	workload      WorkloadLookup
	preparedPages bool
}

// Prepared pages embed their own immutable revision and require explicit
// generation at publication/startup. Ordinary shell hosting keeps its behavior.
func (h *Host) EnablePreparedPages() { h.preparedPages = true }

// Open requires adapter-static's application shell. Prerendered HTML is never
// used for application routes: data publication must not serve old measurements.
func Open(directory string, workload WorkloadLookup) (*Host, error) {
	if workload == nil {
		return nil, fmt.Errorf("frontend requires workload lookup")
	}
	root, e := os.OpenRoot(directory)
	if e != nil {
		return nil, e
	}
	h := &Host{root: root, workload: workload}
	f, e := h.openFile("404.html", MaxShellBytes)
	if e != nil {
		root.Close()
		return nil, fmt.Errorf("frontend application shell: %w", e)
	}
	defer f.Close()
	h.shell, e = io.ReadAll(io.LimitReader(f, MaxShellBytes+1))
	if e != nil || len(h.shell) == 0 || len(h.shell) > MaxShellBytes {
		root.Close()
		return nil, fmt.Errorf("frontend application shell unreadable or outside byte limit")
	}
	h.etag = fmt.Sprintf("\"%x\"", sha256.Sum256(h.shell))
	return h, nil
}

func (h *Host) Close() error { return h.root.Close() }

func safePath(p string) bool {
	if len(p) > 8192 || !utf8.ValidString(p) || strings.ContainsAny(p, "\\\x00") {
		return false
	}
	for _, segment := range strings.Split(p, "/") {
		if strings.HasPrefix(segment, ".") {
			return false
		}
	}
	return path.Clean(p) == strings.TrimSuffix(p, "/") || p == "/"
}

// No listings or symlinks. os.Root confines even a concurrent path replacement
// to the build directory; the final descriptor must still match the stat.
func (h *Host) openFile(name string, ceiling int64) (*os.File, error) {
	parts := strings.Split(name, "/")
	for i := range parts {
		info, e := h.root.Lstat(strings.Join(parts[:i+1], "/"))
		if e != nil {
			return nil, e
		}
		if info.Mode()&os.ModeSymlink != 0 || (i < len(parts)-1 && !info.IsDir()) {
			return nil, fmt.Errorf("invalid frontend path")
		}
		if i != len(parts)-1 {
			continue
		}
		if !info.Mode().IsRegular() || info.Size() > ceiling {
			return nil, fmt.Errorf("invalid frontend file")
		}
		f, e := h.root.Open(name)
		if e != nil {
			return nil, e
		}
		opened, e := f.Stat()
		if e != nil || !opened.Mode().IsRegular() || opened.Size() > ceiling || !os.SameFile(info, opened) {
			f.Close()
			return nil, fmt.Errorf("frontend file changed")
		}
		return f, nil
	}
	return nil, os.ErrNotExist
}

func (h *Host) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != "GET" && r.Method != "HEAD" {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	p := r.URL.Path
	if !safePath(p) {
		http.NotFound(w, r)
		return
	}
	// Imported workload routes have no prerendered route-data file. Serve the
	// build's empty layout data for those known application routes, so SvelteKit
	// can hydrate/navigate and then request the selected corpus from the API.
	if strings.HasPrefix(p, "/bench/") && strings.HasSuffix(p, "/__data.json") {
		workload := strings.TrimSuffix(strings.TrimPrefix(p, "/bench/"), "/__data.json")
		known, err := h.workload(r.Context(), workload)
		if err != nil {
			http.Error(w, "workload catalog unavailable", 503)
			return
		}
		if !known {
			http.NotFound(w, r)
			return
		}
		f, err := h.openFile("history/__data.json", 1024)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			http.Error(w, "route data unavailable", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, "__data.json", info.ModTime(), io.NewSectionReader(f, 0, info.Size()))
		return
	}
	navigation := strings.TrimSuffix(p, "/")
	app := false
	switch navigation {
	case "", "/benchmarks", "/compare", "/history", "/features", "/simd", "/gc", "/memory64", "/threads":
		app = true
	default:
		if strings.HasPrefix(navigation, "/bench/") {
			var e error
			app, e = h.workload(r.Context(), strings.TrimPrefix(navigation, "/bench/"))
			if e != nil {
				http.Error(w, "workload catalog unavailable", http.StatusServiceUnavailable)
				return
			}
			if !app {
				http.NotFound(w, r)
				return
			}
		}
	}
	if app {
		if h.preparedPages && (navigation == "" || navigation == "/benchmarks") {
			name := "index.html"
			if navigation == "/benchmarks" {
				name = "benchmarks/index.html"
			}
			f, err := h.openFile(name, MaxShellBytes)
			if err != nil {
				http.Error(w, "prepared page unavailable", 503)
				return
			}
			defer f.Close()
			info, err := f.Stat()
			if err != nil {
				http.Error(w, "prepared page unavailable", 503)
				return
			}
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			http.ServeContent(w, r, name, info.ModTime(), io.NewSectionReader(f, 0, info.Size()))
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("ETag", h.etag)
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(h.shell))
		return
	}
	name := strings.TrimPrefix(p, "/")
	// HTML belongs to application routing; never expose stale prerendered pages
	// or use a missing asset as an application-shell request.
	if strings.HasSuffix(p, "/") || strings.EqualFold(path.Ext(name), ".html") || name == "" {
		http.NotFound(w, r)
		return
	}
	f, e := h.openFile(name, MaxAssetBytes)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil {
		http.Error(w, "asset unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	if strings.HasPrefix(name, "_app/immutable/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeContent(w, r, name, info.ModTime(), io.NewSectionReader(f, 0, info.Size()))
}
