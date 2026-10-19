// Package frontend serves a fixed application build alongside live API data.
package frontend

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"html"
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
	bootstrap     func(context.Context) ([]byte, error)
	meta          *headMeta
}

// headMeta is the build's og/meta.json: link-preview text and share images per
// route. The shell carries no page-specific head tags, so they are injected here.
type headMeta struct {
	Origin   string              `json:"origin"`
	SiteName string              `json:"siteName"`
	Width    int                 `json:"width"`
	Height   int                 `json:"height"`
	Pages    map[string]pageMeta `json:"pages"`
	Workload pageMeta            `json:"workload"`
}

type pageMeta struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
}

// workloadName mirrors workloadName in src/lib/format.ts.
func workloadName(id string) string {
	switch id {
	case "mechanisms/wasm-host-wasm-loop":
		return "Wasm → host → Wasm"
	case "mechanisms/host-to-wasm-call":
		return "Host → Wasm → host"
	}
	for _, prefix := range []string{"wago/", "applications/"} {
		if strings.HasPrefix(id, prefix) {
			id = strings.TrimPrefix(id, prefix)
			break
		}
	}
	return strings.TrimSuffix(id, "/polybench_run")
}

// headTags renders the head tags for an application route, or nil when the
// build has no entry for it. Every value is HTML-escaped.
func (h *Host) headTags(navigation, escapedPath string) []byte {
	if h.meta == nil {
		return nil
	}
	page, ok := h.meta.Pages[navigation]
	if workload, isBench := strings.CutPrefix(navigation, "/bench/"); isBench {
		name := workloadName(workload)
		page, ok = pageMeta{strings.ReplaceAll(h.meta.Workload.Title, "{name}", name), strings.ReplaceAll(h.meta.Workload.Description, "{name}", name), h.meta.Workload.Image}, h.meta.Workload.Image != ""
	}
	if !ok {
		return nil
	}
	pageURL := h.meta.Origin + strings.TrimSuffix(escapedPath, "/") + "/"
	image := h.meta.Origin + page.Image
	var b bytes.Buffer
	b.WriteString("<title>" + html.EscapeString(page.Title) + "</title>")
	tag := func(kind, key, value string) {
		fmt.Fprintf(&b, `<meta data-wasmfyi-head %s="%s" content="%s">`, kind, key, html.EscapeString(value))
	}
	fmt.Fprintf(&b, `<link data-wasmfyi-head rel="canonical" href="%s">`, html.EscapeString(pageURL))
	tag("name", "description", page.Description)
	tag("property", "og:type", "website")
	tag("property", "og:site_name", h.meta.SiteName)
	tag("property", "og:locale", "en_US")
	tag("property", "og:url", pageURL)
	tag("property", "og:title", page.Title)
	tag("property", "og:description", page.Description)
	tag("property", "og:image", image)
	tag("property", "og:image:type", "image/png")
	tag("property", "og:image:width", fmt.Sprint(h.meta.Width))
	tag("property", "og:image:height", fmt.Sprint(h.meta.Height))
	tag("property", "og:image:alt", page.Title)
	tag("name", "twitter:card", "summary_large_image")
	tag("name", "twitter:title", page.Title)
	tag("name", "twitter:description", page.Description)
	tag("name", "twitter:image", image)
	tag("name", "twitter:image:alt", page.Title)
	return b.Bytes()
}

// SetBootstrap installs public metadata before the application scripts execute.
// It is configured once before serving; private dashboard pages never receive it.
func (h *Host) SetBootstrap(read func(context.Context) ([]byte, error)) { h.bootstrap = read }

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
	// Head metadata is optional: without it the shell is served unchanged.
	if f, e := h.openFile("og/meta.json", 1<<20); e == nil {
		var meta headMeta
		if json.NewDecoder(f).Decode(&meta) == nil && strings.HasPrefix(meta.Origin, "https://") {
			h.meta = &meta
		}
		f.Close()
	}
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
	if ext := path.Ext(r.URL.Path); ext != "" && !strings.EqualFold(ext, ".html") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
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
	// /home is a common guess for the homepage; keep the query string.
	if navigation == "/home" {
		target := "/"
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusMovedPermanently)
		return
	}
	app := false
	switch navigation {
	case "", "/benchmarks", "/dashboard", "/compare", "/history", "/features", "/health", "/simd", "/gc", "/memory64", "/threads":
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
				h.notFoundPage(w, r)
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
		shell, etag := h.shell, h.etag
		if tags := h.headTags(navigation, r.URL.EscapedPath()); tags != nil && p != "/dashboard" && p != "/dashboard/" && bytes.Contains(shell, []byte("</head>")) {
			shell = bytes.Replace(shell, []byte("</head>"), append(tags, "</head>"...), 1)
			etag = fmt.Sprintf("\"%x\"", sha256.Sum256(shell))
		}
		if h.bootstrap != nil && p != "/dashboard" && p != "/dashboard/" && bytes.Contains(shell, []byte("</head>")) {
			if data, err := h.bootstrap(r.Context()); err == nil && len(data) <= 64<<10 && len(data) > 0 {
				// Re-marshal RawMessage to escape script delimiters at the HTML boundary,
				// even if a future bootstrap provider does not use json.Marshal itself.
				safe, encodeErr := json.Marshal(json.RawMessage(data))
				if encodeErr != nil {
					safe = []byte("null")
				}
				script := append([]byte(`<script type="application/json" id="wasmfyi-bootstrap">`), safe...)
				script = append(script, []byte(`</script></head>`)...)
				shell = bytes.Replace(shell, []byte("</head>"), script, 1)
				etag = fmt.Sprintf("\"%x\"", sha256.Sum256(shell))
			}
		}
		w.Header().Set("ETag", etag)
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(shell))
		return
	}
	name := strings.TrimPrefix(p, "/")
	// HTML belongs to application routing; never expose stale prerendered pages
	// or use a missing asset as an application-shell request.
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
		http.Error(w, "asset unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	if strings.HasPrefix(name, "_app/immutable/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeContent(w, r, name, info.ModTime(), io.NewSectionReader(f, 0, info.Size()))
}
