package frontend

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range map[string]string{
		"404.html": "<html>application shell</html>", "index.html": `<html><head><title>WebAssembly runtimes</title></head><body><h1>WebAssembly runtimes</h1></body></html>`,
		"benchmarks/index.html": `<html><head><title>WebAssembly benchmarks</title></head><body><h1>Benchmarks</h1><p>Live measurements load from the API.</p></body></html>`, "_app/immutable/app.js": "console.log('build')",
		"docs/index.html":      `<html><head><title>Data access</title></head><body><h1>API and data access</h1></body></html>`,
		"dashboard/index.html": `<html><head><title>Dashboard</title></head><body>Sign in</body></html>`,
		"history/__data.json":  `{"type":"data","nodes":[{"type":"data","data":[{"pageSeed":1},null],"uses":{"route":1}},null]}`,
		"robots.txt":           "User-agent: *", "og/card.png": "png fixture", ".secret": "secret",
	} {
		p := filepath.Join(dir, name)
		if e := os.MkdirAll(filepath.Dir(p), 0755); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(p, []byte(content), 0644); e != nil {
			t.Fatal(e)
		}
	}
	return dir
}

func TestPreparedHTMLAndImportedWorkloadRouteData(t *testing.T) {
	h, e := Open(fixture(t), func(_ context.Context, id string) (bool, error) { return id == "new-workload", nil })
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	h.EnablePreparedPages()
	for route, body := range map[string]string{"/": `<html><head><title>WebAssembly runtimes</title></head><body><h1>WebAssembly runtimes</h1></body></html>`, "/benchmarks/": `<html><head><title>WebAssembly benchmarks</title></head><body><h1>Benchmarks</h1><p>Live measurements load from the API.</p></body></html>`, "/bench/new-workload/__data.json": `"pageSeed"`} {
		w := request(h, "GET", route)
		if w.Code != 200 || !strings.Contains(w.Body.String(), body) {
			t.Fatal(route, w.Code, w.Body.String())
		}
	}
	if w := request(h, "GET", "/bench/unknown/__data.json"); w.Code != 404 {
		t.Fatal("unknown workload route data accepted")
	}
}

func request(h http.Handler, method, target string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, target, nil))
	return w
}

func TestHostingRoutesAssetsAndCrawlableHTML(t *testing.T) {
	dir := fixture(t)
	h, e := Open(dir, func(_ context.Context, workload string) (bool, error) {
		return workload == "suite/a + b" || workload == "new-workload", nil
	})
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	for route, content := range map[string]string{
		"/": "<h1>WebAssembly runtimes</h1>", "/benchmarks/": "<h1>Benchmarks</h1>",
		"/docs/": "<h1>API and data access</h1>",
	} {
		w := request(h, "GET", route)
		if w.Code != 200 || !strings.Contains(w.Body.String(), content) || w.Header().Get("Cache-Control") != "no-cache" || w.Header().Get("X-Robots-Tag") != "" || w.Header().Get("Content-Type") != "text/html; charset=utf-8" {
			t.Fatalf("%s: %d %s", route, w.Code, w.Body.String())
		}
	}
	for _, route := range []string{"/compare/?s1=a&s2=b", "/history/", "/features/", "/simd/", "/gc/", "/memory64/", "/threads/", "/bench/suite/a%20+%20b/", "/bench/new-workload/"} {
		w := request(h, "GET", route)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "application shell") || w.Header().Get("Cache-Control") != "no-cache" || w.Header().Get("X-Robots-Tag") != "noindex" {
			t.Fatalf("%s: %d %s", route, w.Code, w.Body.String())
		}
	}
	if w := request(h, "GET", "/dashboard/"); w.Code != 200 || w.Header().Get("X-Robots-Tag") != "noindex" || !strings.Contains(w.Body.String(), "Sign in") {
		t.Fatal("dashboard must stay usable but unindexed", w.Code, w.Body.String())
	}
	for _, route := range []string{"/unknown", "/bench/unknown", "/missing.js", "/og/missing.png", "/index.html", "/benchmarks/index.html", "/404.html", "/.secret", "/../robots.txt", "/%2e%2e/robots.txt", "/_app//immutable/app.js", "/robots.txt/", "/%5csecret"} {
		if w := request(h, "GET", route); w.Code != 404 || w.Header().Get("X-Robots-Tag") != "noindex" {
			t.Fatalf("%s: %d", route, w.Code)
		}
	}
	for _, route := range []string{"/robots.txt", "/og/card.png", "/_app/immutable/app.js"} {
		w := request(h, "GET", route)
		if w.Code != 200 || strings.Contains(w.Body.String(), "application shell") {
			t.Fatalf("%s: %d", route, w.Code)
		}
		if route == "/_app/immutable/app.js" && !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
			t.Fatal("asset cache missing")
		}
	}
	w := request(h, "HEAD", "/benchmarks/")
	if w.Code != 200 || w.Body.Len() != 0 {
		t.Fatal("HEAD must omit body")
	}
	w = request(h, "POST", "/benchmarks")
	if w.Code != 405 || w.Header().Get("Allow") != "GET, HEAD" {
		t.Fatal("method admission")
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("If-None-Match", request(h, "GET", "/").Header().Get("ETag"))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 304 || w.Body.Len() != 0 {
		t.Fatal("shell conditional request")
	}
}

func TestHostingConfinementAndMissingBuild(t *testing.T) {
	dir := fixture(t)
	outside := t.TempDir()
	if e := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("private"), 0644); e != nil {
		t.Fatal(e)
	}
	for name, target := range map[string]string{"escape.txt": filepath.Join(outside, "secret.txt"), "escape": outside, "inside.txt": filepath.Join(dir, "robots.txt")} {
		if e := os.Symlink(target, filepath.Join(dir, name)); e != nil {
			t.Fatal(e)
		}
	}
	h, e := Open(dir, func(context.Context, string) (bool, error) { return false, errors.New("database unavailable") })
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	for _, route := range []string{"/escape.txt", "/escape/secret.txt", "/inside.txt"} {
		if w := request(h, "GET", route); w.Code != 404 || strings.Contains(w.Body.String(), "private") {
			t.Fatalf("escape: %s", route)
		}
	}
	for _, method := range []string{"GET", "HEAD"} {
		w := request(h, method, "/bench/workload")
		if w.Code != 503 || w.Header().Get("X-Robots-Tag") != "noindex" || method == "HEAD" && w.Body.Len() != 0 {
			t.Fatal("lookup failure must not become fake not-measured response", method, w.Code)
		}
	}
	if _, e = Open(t.TempDir(), func(context.Context, string) (bool, error) { return true, nil }); e == nil {
		t.Fatal("missing shell accepted")
	}
	if e = os.Remove(filepath.Join(dir, "404.html")); e != nil {
		t.Fatal(e)
	}
	if e = os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(dir, "404.html")); e != nil {
		t.Fatal(e)
	}
	if _, e = Open(dir, func(context.Context, string) (bool, error) { return true, nil }); e == nil {
		t.Fatal("symlink shell accepted")
	}
}

func TestHostingBoundedFilesAndSelectedRanges(t *testing.T) {
	dir := fixture(t)
	f, e := os.Create(filepath.Join(dir, "oversized.bin"))
	if e != nil {
		t.Fatal(e)
	}
	if e = f.Truncate(MaxAssetBytes + 1); e != nil {
		t.Fatal(e)
	}
	f.Close()
	h, e := Open(dir, func(context.Context, string) (bool, error) { return false, nil })
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	if w := request(h, "GET", "/oversized.bin"); w.Code != 404 {
		t.Fatal("oversized asset admitted")
	}
	r := httptest.NewRequest("GET", "/robots.txt", nil)
	r.Header.Set("Range", "bytes=0-3")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "User" {
		t.Fatal("selected static range")
	}
	if e = os.WriteFile(filepath.Join(dir, "404.html"), nil, 0644); e != nil {
		t.Fatal(e)
	}
	if _, e = Open(dir, func(context.Context, string) (bool, error) { return false, nil }); e == nil {
		t.Fatal("empty shell admitted")
	}
}

func TestCanonicalPageRedirectsPreserveEscapedPathsAndQueries(t *testing.T) {
	h, err := Open(fixture(t), func(_ context.Context, id string) (bool, error) { return id == "suite/a ?#&b", nil })
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	for from, to := range map[string]string{
		"/benchmarks": "/benchmarks/", "/docs?format=json": "/docs/?format=json",
		"/compare?s1=a%2Fb&s2=c":                   "/compare/?s1=a%2Fb&s2=c",
		"/bench/suite/a%20%3F%23&b?metric=compile": "/bench/suite/a%20%3F%23&b/?metric=compile",
	} {
		for _, method := range []string{"GET", "HEAD"} {
			w := request(h, method, from)
			if w.Code != http.StatusPermanentRedirect || w.Header().Get("Location") != to {
				t.Fatal(method, from, w.Code, w.Header().Get("Location"))
			}
			if method == "HEAD" && w.Body.Len() != 0 {
				t.Fatal("redirect HEAD body")
			}
		}
	}
	if w := request(h, "GET", "/bench/unknown"); w.Code != 404 || w.Header().Get("Location") != "" {
		t.Fatal("unknown workload must not redirect to a soft 404")
	}
}

func TestPageContentRevalidationAndHeadParity(t *testing.T) {
	dir := fixture(t)
	h, err := Open(dir, func(_ context.Context, id string) (bool, error) { return id == "new", nil })
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	for _, route := range []string{"/", "/benchmarks/", "/docs/", "/dashboard/", "/bench/new/", "/missing/", "/missing.js", "/index.html", "/bench/missing/__data.json"} {
		get, head := request(h, "GET", route), request(h, "HEAD", route)
		if head.Code != get.Code || head.Body.Len() != 0 {
			t.Fatal("HEAD status/body mismatch", route)
		}
		for _, name := range []string{"Content-Type", "Cache-Control", "ETag", "X-Robots-Tag", "X-Content-Type-Options"} {
			if head.Header().Get(name) != get.Header().Get(name) {
				t.Fatal("HEAD header mismatch", route, name)
			}
		}
		if get.Code != 200 {
			continue
		}
		r := httptest.NewRequest("GET", route, nil)
		r.Header.Set("If-None-Match", get.Header().Get("ETag"))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 304 || w.Body.Len() != 0 {
			t.Fatal("conditional page", route, w.Code)
		}
	}
	old := request(h, "GET", "/").Header().Get("ETag")
	if err = os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html><title>Changed page</title><h1>Changed page</h1></html>"), 0644); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("If-None-Match", old)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("ETag") == old || !strings.Contains(w.Body.String(), "Changed page") {
		t.Fatal("HTML validator did not track content")
	}
}

func TestPreparedPagesFailClosedAndClientsReceiveTheSameHTML(t *testing.T) {
	dir := fixture(t)
	h, err := Open(dir, func(context.Context, string) (bool, error) { return false, nil })
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	want := request(h, "GET", "/docs/").Body.String()
	for _, agent := range []string{"Googlebot", "GPTBot", "Mozilla/5.0"} {
		r := httptest.NewRequest("GET", "/docs/", nil)
		r.Header.Set("User-Agent", agent)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || w.Body.String() != want {
			t.Fatal("user-agent-specific content", agent)
		}
	}
	h.EnablePreparedPages()
	if err = os.Remove(filepath.Join(dir, "benchmarks/index.html")); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "GET", "/benchmarks/"); w.Code != 503 || w.Header().Get("X-Robots-Tag") != "noindex" {
		t.Fatal("missing prepared page became a success")
	}
	if err = os.WriteFile(filepath.Join(dir, "docs/index.html"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "GET", "/docs/"); w.Code != 503 {
		t.Fatal("empty static page became a success")
	}
}

func TestBuiltInventoryWorkloadsDoNotRequireDatabaseMeasurements(t *testing.T) {
	dir := fixture(t)
	for name, body := range map[string]string{
		"workloads/index.html":             "<html><title>Workload catalog</title><h1>Workload catalog</h1></html>",
		"bench/inventory-only/index.html":  "<html><title>Inventory workload</title><h1>Inventory workload</h1><p>Prepared corpus metadata; measurements load separately.</p></html>",
		"bench/inventory-only/__data.json": `{"type":"data","nodes":[{"type":"data","data":[{"pageSeed":1,"workloadDescription":2},null,"Inventory workload"],"uses":{"route":1}},null]}`,
	} {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	lookups := 0
	available := false
	h, err := Open(dir, func(context.Context, string) (bool, error) {
		lookups++
		if available {
			return false, nil
		}
		return false, errors.New("database unavailable")
	})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	for route, text := range map[string]string{
		"/workloads/":                       "<h1>Workload catalog</h1>",
		"/bench/inventory-only/":            "<h1>Inventory workload</h1>",
		"/bench/inventory-only/__data.json": `"workloadDescription"`,
	} {
		get := request(h, "GET", route)
		if get.Code != 200 || !strings.Contains(get.Body.String(), text) || get.Header().Get("X-Robots-Tag") != "" {
			t.Fatal("inventory page unavailable", route, get.Code, get.Body.String())
		}
		if head := request(h, "HEAD", route); head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("Content-Type") != get.Header().Get("Content-Type") {
			t.Fatal("inventory HEAD response", route, head.Code)
		}
	}
	if w := request(h, "GET", "/bench/inventory-only?metric=compile"); w.Code != 308 || w.Header().Get("Location") != "/bench/inventory-only/?metric=compile" {
		t.Fatal("inventory canonical redirect", w.Code)
	}
	if lookups != 0 {
		t.Fatal("static corpus inventory depended on the database", lookups)
	}
	available = true
	for _, route := range []string{"/bench/unknown/", "/bench/inventory-only/index.html", "/bench/inventory-only/index.html/__data.json"} {
		if w := request(h, "GET", route); w.Code != 404 || w.Header().Get("X-Robots-Tag") != "noindex" {
			t.Fatal("unknown or duplicate inventory route", route, w.Code)
		}
	}
}
