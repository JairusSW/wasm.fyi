// Package frontend serves a fixed application build alongside live API data.
package frontend

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
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
// generation at publication/startup. Missing prepared files must fail closed.
func (h *Host) EnablePreparedPages() { h.preparedPages = true }

// Open requires adapter-static's application shell. Public pages use the build
// HTML, whose initial data is empty; live measurements still come from the API.
// Newly imported workload routes can fall back to the interactive shell.
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

// notFoundPage answers a missing page with the application shell and a 404
// status, so the site renders its own not-found page. Missing assets (any path
// with a non-HTML file extension) keep the plain 404.
func (h *Host) notFoundPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Robots-Tag", "noindex")
	w.Header().Set("Cache-Control", "no-cache")
	if ext := path.Ext(r.URL.Path); ext != "" && !strings.EqualFold(ext, ".html") {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		if r.Method != http.MethodHead {
			io.WriteString(w, "404 page not found\n")
		}
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	if r.Method != "HEAD" {
		w.Write(h.shell)
	}
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
		h.notFoundPage(w, r)
		return
	}
	// Inventory workloads have their own route data. Newly imported workloads
	// use empty layout data so navigation can load their live API measurements.
	if strings.HasPrefix(p, "/bench/") && strings.HasSuffix(p, "/__data.json") {
		staticErr := h.serveRouteData(w, r, strings.TrimPrefix(p, "/"))
		if staticErr == nil {
			return
		}
		workload := strings.TrimSuffix(strings.TrimPrefix(p, "/bench/"), "/__data.json")
		known, err := h.lookupWorkload(r.Context(), workload)
		if err != nil {
			pageError(w, r, "workload catalog unavailable")
			return
		}
		if !known {
			h.notFoundPage(w, r)
			return
		}
		if !errors.Is(staticErr, os.ErrNotExist) {
			pageError(w, r, "route data unavailable")
			return
		}
		if err = h.serveRouteData(w, r, "history/__data.json"); errors.Is(err, os.ErrNotExist) {
			h.notFoundPage(w, r)
		} else if err != nil {
			pageError(w, r, "route data unavailable")
		}
		return
	}
	navigation := strings.TrimSuffix(p, "/")
	app := false
	switch navigation {
	case "", "/docs", "/workloads", "/benchmarks", "/dashboard", "/compare", "/history", "/features", "/health", "/simd", "/gc", "/memory64", "/threads":
		app = true
	default:
		if strings.HasPrefix(navigation, "/bench/") {
			// A built corpus description is useful even before it has any
			// measurements. Check only confined, regular build files.
			f, err := h.openFile(strings.TrimPrefix(navigation, "/")+"/index.html", MaxShellBytes)
			if err == nil {
				f.Close()
				app = true
			} else {
				app, err = h.lookupWorkload(r.Context(), strings.TrimPrefix(navigation, "/bench/"))
				if err != nil {
					pageError(w, r, "workload catalog unavailable")
					return
				}
			}
			if !app {
				h.notFoundPage(w, r)
				return
			}
		}
	}
	if app {
		// Match SvelteKit's trailingSlash=always and keep filters intact. Use the
		// escaped request path so workload IDs cannot change redirect syntax.
		if p != "/" && !strings.HasSuffix(p, "/") {
			target := r.URL.EscapedPath() + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			w.Header().Set("Cache-Control", "no-cache")
			http.Redirect(w, r, target, http.StatusPermanentRedirect)
			return
		}
		if navigation == "/dashboard" {
			w.Header().Set("X-Robots-Tag", "noindex")
		}
		name := strings.TrimPrefix(navigation, "/")
		if name != "" {
			name += "/"
		}
		name += "index.html"
		// Prepared pages contain an explicitly pinned revision. Keep their
		// fail-closed behavior if a required file is absent or unreadable.
		required := h.preparedPages && (navigation == "" || navigation == "/benchmarks")
		if err := h.servePage(w, r, name); err == nil {
			return
		} else if required || !errors.Is(err, os.ErrNotExist) {
			pageError(w, r, "page unavailable")
			return
		}
		// Client-only routes remain usable after publication without a rebuild,
		// but an empty application shell is not an indexable content page.
		w.Header().Set("X-Robots-Tag", "noindex")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("ETag", h.etag)
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(h.shell))
		return
	}
	name := strings.TrimPrefix(p, "/")
	// HTML belongs to canonical application routing. Never expose duplicate
	// index.html URLs or use a missing asset as an application-shell request.
	if strings.HasSuffix(p, "/") || strings.EqualFold(path.Ext(name), ".html") || name == "" {
		h.notFoundPage(w, r)
		return
	}
	f, e := h.openFile(name, MaxAssetBytes)
	if e != nil {
		h.notFoundPage(w, r)
		return
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil {
		pageError(w, r, "asset unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	if strings.HasPrefix(name, "_app/immutable/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeContent(w, r, name, info.ModTime(), io.NewSectionReader(f, 0, info.Size()))
}

// servePage revalidates bounded HTML by its content, including on HEAD requests.
// The same document is returned to people, crawlers and link unfurlers.
func (h *Host) servePage(w http.ResponseWriter, r *http.Request, name string) error {
	f, err := h.openFile(name, MaxShellBytes)
	if err != nil {
		return err
	}
	defer f.Close()
	body, err := io.ReadAll(io.LimitReader(f, MaxShellBytes+1))
	if err != nil {
		return err
	}
	if len(body) == 0 || len(body) > MaxShellBytes {
		return fmt.Errorf("frontend page unreadable or outside byte limit")
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("ETag", fmt.Sprintf("\"%x\"", sha256.Sum256(body)))
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(body))
	return nil
}

func (h *Host) lookupWorkload(ctx context.Context, workload string) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return h.workload(ctx, workload)
}

func pageError(w http.ResponseWriter, r *http.Request, message string) {
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Robots-Tag", "noindex")
	w.WriteHeader(http.StatusServiceUnavailable)
	if r.Method != http.MethodHead {
		io.WriteString(w, message+"\n")
	}
}

func (h *Host) serveRouteData(w http.ResponseWriter, r *http.Request, name string) error {
	f, err := h.openFile(name, MaxShellBytes)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "__data.json", info.ModTime(), io.NewSectionReader(f, 0, info.Size()))
	return nil
}
