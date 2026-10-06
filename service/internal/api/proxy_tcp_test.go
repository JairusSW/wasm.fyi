package api

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

// Both hops use real sockets. The public hop terminates TLS and overwrites the
// sole trusted client header from the connecting peer, never from user input.
func TestTLSProxySanitizesClientHeadersAndReservesPublisherAccess(t *testing.T) {
	s, e := store.Open(t.TempDir(), "proxy-tcp")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	token := strings.Repeat("x", 32)
	limits := DefaultRequestLimits()
	limits.PublicBurst = 1
	limits.PublicRate = .001
	limits.PublisherBurst = 10
	limits.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
	handler, e := NewWithRequestLimits(s, token, bytes.Repeat([]byte{1}, 32), limits)
	if e != nil {
		t.Fatal(e)
	}
	backend := httptest.NewServer(handler)
	defer backend.Close()
	target, e := url.Parse(backend.URL)
	if e != nil {
		t.Fatal(e)
	}
	proxy := httptest.NewTLSServer(&httputil.ReverseProxy{Rewrite: func(p *httputil.ProxyRequest) {
		p.SetURL(target)
		p.SetXForwarded()
		host, _, e := net.SplitHostPort(p.In.RemoteAddr)
		if e != nil {
			panic(e)
		}
		p.Out.Header.Del("X-Real-IP")
		p.Out.Header.Set("X-Real-IP", host)
	}})
	defer proxy.Close()
	call := func(path string, spoof []string, auth string) (int, http.Header) {
		t.Helper()
		r, e := http.NewRequest("GET", proxy.URL+path, nil)
		if e != nil {
			t.Fatal(e)
		}
		r.Header["X-Real-Ip"] = spoof
		r.Header.Set("Authorization", auth)
		response, e := proxy.Client().Do(r)
		if e != nil {
			t.Fatal(e)
		}
		defer response.Body.Close()
		if _, e = io.Copy(io.Discard, response.Body); e != nil {
			t.Fatal(e)
		}
		return response.StatusCode, response.Header
	}
	if status, _ := call("/api/v1/manifest", []string{"malformed", "198.51.100.1"}, ""); status != 200 {
		t.Fatal("proxy did not replace client-supplied header", status)
	}
	if status, headers := call("/api/v1/manifest", []string{"198.51.100.2"}, ""); status != 429 || headers.Get("Retry-After") == "" {
		t.Fatal("header spoof minted a second client budget", status)
	}
	if status, _ := call("/admin/v1/metrics", []string{"malformed"}, "Bearer "+token); status != 200 {
		t.Fatal("public pressure blocked publisher", status)
	}
	// A second real connecting address gets its own budget behind the same hop.
	probe, e := net.ListenTCP("tcp", &net.TCPAddr{IP: net.ParseIP("127.0.0.2")})
	if e == nil {
		probe.Close()
		transport := proxy.Client().Transport.(*http.Transport).Clone()
		defer transport.CloseIdleConnections()
		dialer := &net.Dialer{LocalAddr: &net.TCPAddr{IP: net.ParseIP("127.0.0.2")}, Timeout: 5 * time.Second}
		transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, address)
		}
		client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
		r, e := http.NewRequest("GET", proxy.URL+"/api/v1/manifest", nil)
		if e != nil {
			t.Fatal(e)
		}
		r.Header.Set("X-Real-IP", "127.0.0.1")
		response, e := client.Do(r)
		if e != nil {
			t.Fatal("second real peer could not connect", e)
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatal("real clients shared one proxy budget", response.StatusCode)
		}
	} else {
		if runtime.GOOS == "linux" {
			t.Fatal("required native Linux secondary peer unavailable", e)
		}
		t.Log("secondary loopback address unavailable; native Linux gate exercises this case")
	}
	// Trusted transport without a sanitized header fails closed for public reads.
	response, e := backend.Client().Get(backend.URL + "/api/v1/manifest")
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 400 {
		t.Fatal("trusted direct peer without client header accepted", response.StatusCode)
	}
}

func TestRealHTTPDefaultDoesNotTrustSpoofedForwardingHeaders(t *testing.T) {
	s, e := store.Open(t.TempDir(), "proxy-default-tcp")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	limits := DefaultRequestLimits()
	limits.PublicBurst = 1
	limits.PublicRate = .001
	handler, e := NewWithRequestLimits(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32), limits)
	if e != nil {
		t.Fatal(e)
	}
	backend := httptest.NewServer(handler)
	defer backend.Close()
	for i, spoof := range []string{"malformed", "198.51.100.5"} {
		r, e := http.NewRequest("GET", backend.URL+"/api/v1/manifest", nil)
		if e != nil {
			t.Fatal(e)
		}
		r.Header.Set("X-Real-IP", spoof)
		response, e := backend.Client().Do(r)
		if e != nil {
			t.Fatal(e)
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		want := 200
		if i > 0 {
			want = 429
		}
		if response.StatusCode != want {
			t.Fatal("default trust boundary changed", response.StatusCode, want)
		}
	}
}
