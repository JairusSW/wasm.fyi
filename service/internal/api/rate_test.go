package api

import (
	"bytes"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func TestBoundedPeerBudgetsAndRefill(t *testing.T) {
	limits := RequestLimits{PublicRate: 1, PublicBurst: 2, PublisherRate: 2, PublisherBurst: 3, Clients: 3, Idle: time.Second}
	limiter := newRequestLimiter(limits)
	now := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 2; i++ {
		if ok, _ := limiter.allow("127.0.0.1:1000", false, now); !ok {
			t.Fatal("lost initial burst")
		}
	}
	if ok, retry := limiter.allow("[::ffff:127.0.0.1]:2000", false, now); ok || retry < 1 {
		t.Fatal("port/mapped address bypassed budget")
	}
	if ok, _ := limiter.allow("127.0.0.1:1000", true, now); !ok {
		t.Fatal("public traffic consumed publisher budget")
	}
	if ok, _ := limiter.allow("127.0.0.2:1000", false, now); !ok {
		t.Fatal("new peer lacks budget")
	}
	if ok, _ := limiter.allow("127.0.0.3:1000", false, now); ok || len(limiter.clients) != 3 {
		t.Fatal("client state grew past cap")
	}
	if ok, _ := limiter.allow("127.0.0.1:1000", false, now.Add(500*time.Millisecond)); ok {
		t.Fatal("refilled too early")
	}
	if ok, _ := limiter.allow("127.0.0.3:1000", false, now.Add(2*time.Second)); !ok {
		t.Fatal("idle state was not reclaimed")
	}
	if len(limiter.clients) > 3 {
		t.Fatal("unbounded client state")
	}
}
func TestPeerRateLimitCannotBeBypassedByForwardingHeaders(t *testing.T) {
	s, err := store.Open(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	token := strings.Repeat("x", 32)
	limits := DefaultRequestLimits()
	limits.PublicRate = 0.001
	limits.PublicBurst = 2
	handler, err := NewWithRequestLimits(s, token, bytes.Repeat([]byte{1}, 32), limits)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		r := httptest.NewRequest("GET", "/api/v1/manifest", nil)
		r.RemoteAddr = "192.0.2.1:1234"
		r.Header.Set("X-Forwarded-For", []string{"198.51.100.1", "198.51.100.2", "198.51.100.3"}[i])
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if i < 2 && w.Code != 200 || i == 2 && (w.Code != 429 || w.Header().Get("Retry-After") == "") {
			t.Fatal("incorrect peer admission", i, w.Code)
		}
	}
	admin := httptest.NewRequest("GET", "/admin/v1/metrics", nil)
	admin.RemoteAddr = "192.0.2.1:4321"
	admin.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, admin)
	if w.Code != 200 {
		t.Fatal("public exhaustion denied publisher", w.Code)
	}
}

func TestPublicClientTableReservesPublisherCapacity(t *testing.T) {
	limits := DefaultRequestLimits()
	limits.Clients = 3
	limiter := newRequestLimiter(limits)
	now := time.Now()
	for _, peer := range []string{"192.0.2.1:1", "192.0.2.2:1"} {
		if ok, _ := limiter.allow(peer, false, now); !ok {
			t.Fatal("public capacity lost")
		}
	}
	if ok, _ := limiter.allow("192.0.2.3:1", false, now); ok {
		t.Fatal("public clients consumed reserved capacity")
	}
	if ok, _ := limiter.allow("192.0.2.4:1", true, now); !ok {
		t.Fatal("public clients blocked a new publisher")
	}
	if len(limiter.clients) != 3 {
		t.Fatal("client state exceeded configured cap")
	}
}
