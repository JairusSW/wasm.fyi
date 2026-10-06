package api

import (
	"bytes"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func TestTrustedProxyClientBudgetsAndPublisherIsolation(t *testing.T) {
	s, err := store.Open(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	token := strings.Repeat("x", 32)
	limits := DefaultRequestLimits()
	limits.PublicRate = 0.001
	limits.PublicBurst = 1
	limits.PublisherRate = 0.001
	limits.PublisherBurst = 1
	limits.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("192.0.2.1/32")}
	h, err := NewWithRequestLimits(s, token, bytes.Repeat([]byte{1}, 32), limits)
	if err != nil {
		t.Fatal(err)
	}
	call := func(path, peer, client, auth string) int {
		r := httptest.NewRequest("GET", path, nil)
		r.RemoteAddr = peer
		if client != "" {
			r.Header.Set("X-Real-IP", client)
		}
		r.Header.Set("Authorization", auth)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	if call("/api/v1/manifest", "192.0.2.1:1", "198.51.100.1", "") != 200 || call("/api/v1/manifest", "192.0.2.1:2", "198.51.100.2", "") != 200 {
		t.Fatal("proxy clients share one transport budget")
	}
	if call("/api/v1/manifest", "192.0.2.1:3", "::ffff:198.51.100.1", "") != 429 {
		t.Fatal("mapped identity bypassed client budget")
	}
	if call("/api/v1/manifest", "192.0.2.2:1", "198.51.100.3", "") != 200 || call("/api/v1/manifest", "192.0.2.2:2", "198.51.100.4", "") != 429 {
		t.Fatal("untrusted peer minted forwarded budgets")
	}
	if call("/admin/v1/metrics", "192.0.2.1:4", "malformed", "Bearer "+token) != 200 || call("/admin/v1/metrics", "192.0.2.1:5", "198.51.100.5", "Bearer "+token) != 429 {
		t.Fatal("publisher budget depended on forwarded identity")
	}
	if call("/healthz", "192.0.2.1:6", "", "") != 200 {
		t.Fatal("transport health probe required a forwarded client")
	}
	// Caller mutation after construction must not enlarge the trust boundary.
	limits.TrustedProxies[0] = netip.MustParsePrefix("192.0.2.3/32")
	if call("/api/v1/manifest", "192.0.2.3:1", "198.51.100.6", "") != 200 || call("/api/v1/manifest", "192.0.2.3:2", "198.51.100.7", "") != 429 {
		t.Fatal("caller changed installed proxy policy")
	}
}

func TestProxyAddressValidationAndDefaultNonTrust(t *testing.T) {
	limits := DefaultRequestLimits()
	limits.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("2001:db8::1/128")}
	limiter := newRequestLimiter(limits)
	for _, values := range [][]string{nil, {"198.51.100.1", "198.51.100.2"}, {"198.51.100.1, 198.51.100.2"}, {"example.com"}, {"198.51.100.1:80"}, {"fe80::1%eth0"}, {"0.0.0.0"}, {"ff02::1"}, {strings.Repeat("x", 65)}} {
		r := httptest.NewRequest("GET", "/api/v1/manifest", nil)
		r.RemoteAddr = "[2001:db8::1]:80"
		r.Header["X-Real-Ip"] = values
		if _, err := limiter.clientIdentity(r, false); err == nil {
			t.Fatal("invalid proxy address accepted", values)
		}
	}
	r := httptest.NewRequest("GET", "/api/v1/manifest", nil)
	r.RemoteAddr = "[2001:db8::1]:80"
	r.Header.Set("X-Real-IP", "2001:db8::2")
	if identity, err := limiter.clientIdentity(r, false); err != nil || identity != "2001:db8::2" {
		t.Fatal("valid IPv6 client lost", identity, err)
	}
	plain := newRequestLimiter(DefaultRequestLimits())
	r.Header.Set("X-Real-IP", "malformed")
	if identity, err := plain.clientIdentity(r, false); err != nil || identity != "2001:db8::1" {
		t.Fatal("default trusts proxy headers", identity, err)
	}
	for _, prefix := range []netip.Prefix{{}, netip.MustParsePrefix("0.0.0.0/0"), netip.MustParsePrefix("::/0"), netip.MustParsePrefix("::ffff:192.0.2.1/128")} {
		bad := DefaultRequestLimits()
		bad.TrustedProxies = []netip.Prefix{prefix}
		if bad.valid() {
			t.Fatal("invalid trust boundary accepted", prefix)
		}
	}
}
