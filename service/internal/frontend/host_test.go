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
		"404.html": "<html>application shell</html>", "index.html": "stale homepage",
		"benchmarks/index.html": "stale measurements", "_app/immutable/app.js": "console.log('build')",
		"history/__data.json": `{"type":"data","nodes":[{"type":"data","data":[{"pageSeed":1},null],"uses":{"route":1}},null]}`,
		"robots.txt":          "User-agent: *", "og/card.png": "png fixture", ".secret": "secret",
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
	for route, body := range map[string]string{"/": "stale homepage", "/benchmarks/": "stale measurements", "/bench/new-workload/__data.json": `"pageSeed"`} {
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

func TestHostingRoutesAssetsAndFreshShell(t *testing.T) {
	dir := fixture(t)
	h, e := Open(dir, func(_ context.Context, workload string) (bool, error) {
		return workload == "suite/a + b" || workload == "new-workload", nil
	})
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	for _, route := range []string{"/", "/benchmarks", "/benchmarks/", "/compare?s1=a&s2=b", "/history", "/features", "/simd", "/gc", "/memory64", "/threads", "/bench/suite/a%20+%20b", "/bench/new-workload/"} {
		w := request(h, "GET", route)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "application shell") || w.Header().Get("Cache-Control") != "no-cache" {
			t.Fatalf("%s: %d %s", route, w.Code, w.Body.String())
		}
	}
	for _, route := range []string{"/unknown", "/bench/unknown", "/missing.js", "/og/missing.png", "/index.html", "/benchmarks/index.html", "/404.html", "/.secret", "/../robots.txt", "/%2e%2e/robots.txt", "/_app//immutable/app.js", "/robots.txt/", "/%5csecret"} {
		if w := request(h, "GET", route); w.Code != 404 {
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
	w := request(h, "HEAD", "/benchmarks")
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
	if w := request(h, "GET", "/bench/workload"); w.Code != 503 {
		t.Fatal("lookup failure must not become fake not-measured response")
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

func TestBootstrapEscapingFreshnessAndPrivateRouteExclusion(t *testing.T) {
	dir := fixture(t)
	if err := os.WriteFile(filepath.Join(dir, "404.html"), []byte("<html><head></head><body>application shell</body></html>"), 0644); err != nil {
		t.Fatal(err)
	}
	host, err := Open(dir, func(context.Context, string) (bool, error) { return false, nil })
	if err != nil {
		t.Fatal(err)
	}
	defer host.Close()
	data := []byte(`{"revision":"one","platforms":[],"label":"</script><script>alert(1)</script>"}`)
	host.SetBootstrap(func(context.Context) ([]byte, error) { return data, nil })
	first := request(host, "GET", "/benchmarks/")
	if first.Code != 200 || !strings.Contains(first.Body.String(), `id="wasmfyi-bootstrap"`) || strings.Contains(first.Body.String(), "<script>alert(1)") {
		t.Fatal(first.Code, first.Body.String())
	}
	old := first.Header().Get("ETag")
	data = []byte(`{"revision":"two","platforms":[]}`)
	r := httptest.NewRequest("GET", "/benchmarks/", nil)
	r.Header.Set("If-None-Match", old)
	second := httptest.NewRecorder()
	host.ServeHTTP(second, r)
	if second.Code != 200 || second.Header().Get("ETag") == old || !strings.Contains(second.Body.String(), `"two"`) {
		t.Fatal("bootstrap metadata was served stale")
	}
	for _, path := range []string{"/dashboard", "/dashboard/", "/_app/immutable/app.js"} {
		response := request(host, "GET", path)
		if strings.Contains(response.Body.String(), "wasmfyi-bootstrap") {
			t.Fatal("bootstrap injected into", path)
		}
	}
}

func TestHeadMetadataInjectedPerRoute(t *testing.T) {
	dir := fixture(t)
	meta := `{"origin":"https://wasm.fyi","siteName":"wasm.fyi","width":1200,"height":630,
		"pages":{"":{"title":"Home","description":"Home page","image":"/og/home.png"},"/simd":{"title":"SIMD <b>","description":"Lanes & \"vectors\"","image":"/og/simd.png"},"/dashboard":{"title":"Private","description":"x","image":"/og/home.png"}},
		"workload":{"title":"{name} · wasm.fyi","description":"{name} measured","image":"/og/workload.png"}}`
	for name, content := range map[string]string{"404.html": "<html><head></head><body>application shell</body></html>", "og/meta.json": meta} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	host, err := Open(dir, func(_ context.Context, id string) (bool, error) { return id == "applications/image blur", nil })
	if err != nil {
		t.Fatal(err)
	}
	defer host.Close()
	for route, want := range map[string][]string{
		"/":                                {"<title>Home</title>", `property="og:image" content="https://wasm.fyi/og/home.png"`, `rel="canonical" href="https://wasm.fyi/"`, `name="twitter:card" content="summary_large_image"`},
		"/simd/":                           {"<title>SIMD &lt;b&gt;</title>", `content="Lanes &amp; &#34;vectors&#34;"`, `property="og:url" content="https://wasm.fyi/simd/"`},
		"/bench/applications/image%20blur": {"<title>image blur · wasm.fyi</title>", `content="https://wasm.fyi/og/workload.png"`, `href="https://wasm.fyi/bench/applications/image%20blur/"`},
	} {
		body := request(host, "GET", route).Body.String()
		for _, w := range want {
			if !strings.Contains(body, w) {
				t.Fatalf("%s: missing %s in %s", route, w, body)
			}
		}
		if strings.Index(body, "og:title") > strings.Index(body, "</head>") {
			t.Fatal(route, "tags outside head")
		}
	}
	for _, route := range []string{"/history", "/dashboard/"} {
		if body := request(host, "GET", route).Body.String(); strings.Contains(body, "og:title") {
			t.Fatal("unexpected metadata for", route)
		}
	}
}

func TestHomeRedirectsToRoot(t *testing.T) {
	h, e := Open(fixture(t), func(context.Context, string) (bool, error) { return false, nil })
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	for route, want := range map[string]string{"/home": "/", "/home/": "/", "/home?m=m2": "/?m=m2"} {
		w := request(h, "GET", route)
		if w.Code != http.StatusMovedPermanently || w.Header().Get("Location") != want {
			t.Fatalf("%s: %d %q", route, w.Code, w.Header().Get("Location"))
		}
	}
}
