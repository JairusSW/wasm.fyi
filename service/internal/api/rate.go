package api

import (
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"net"
	"net/http"
	"net/netip"
	"sync"
	"time"
)

type RequestLimits struct {
	PublicRate     float64
	PublicBurst    int
	PublisherRate  float64
	PublisherBurst int
	Clients        int
	Idle           time.Duration
	TrustedProxies []netip.Prefix
}

func DefaultRequestLimits() RequestLimits {
	return RequestLimits{PublicRate: 60, PublicBurst: 120, PublisherRate: 100, PublisherBurst: 400, Clients: 4096, Idle: 5 * time.Minute}
}

type clientBucket struct {
	tokens  float64
	updated time.Time
	seen    time.Time
}
type requestLimiter struct {
	mu            sync.Mutex
	limits        RequestLimits
	clients       map[string]clientBucket
	nextSweep     time.Time
	publicClients int
}

func (l RequestLimits) valid() bool {
	if len(l.TrustedProxies) > 64 {
		return false
	}
	for _, prefix := range l.TrustedProxies {
		if !prefix.IsValid() || prefix.Bits() == 0 || prefix.Addr().Is4In6() {
			return false
		}
	}
	return l.PublicRate > 0 && l.PublicRate <= 100000 && l.PublisherRate > 0 && l.PublisherRate <= 100000 && l.PublicBurst > 0 && l.PublicBurst <= 100000 && l.PublisherBurst > 0 && l.PublisherBurst <= 100000 && l.Clients >= 2 && l.Clients <= 100000 && l.Idle >= time.Second && l.Idle <= time.Hour
}
func newRequestLimiter(limits RequestLimits) *requestLimiter {
	limits.TrustedProxies = append([]netip.Prefix(nil), limits.TrustedProxies...)
	return &requestLimiter{limits: limits, clients: map[string]clientBucket{}}
}

// Only explicitly trusted transport peers may attest one client address. Public
// budgets use that address; authenticated publication stays on the transport peer.
func (l *requestLimiter) clientIdentity(r *http.Request, publisher bool) (string, error) {
	peer := peerIdentity(r.RemoteAddr)
	if publisher || r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
		return peer, nil
	}
	address, err := netip.ParseAddr(peer)
	if err != nil {
		return peer, nil
	}
	trusted := false
	for _, prefix := range l.limits.TrustedProxies {
		if prefix.Contains(address) {
			trusted = true
			break
		}
	}
	if !trusted {
		return peer, nil
	}
	values := r.Header.Values("X-Real-IP")
	if len(values) != 1 || len(values[0]) > 64 {
		return "", wire.Invalid("trusted proxy requires one client address")
	}
	client, err := netip.ParseAddr(values[0])
	if err != nil || client.Zone() != "" || client.IsUnspecified() || client.IsMulticast() {
		return "", wire.Invalid("invalid trusted proxy client address")
	}
	return client.Unmap().String(), nil
}
func peerIdentity(remote string) string {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return "unknown"
	}
	return addr.Unmap().String()
}

// Publisher and public traffic have independent budgets and bounded state.
// The caller supplies an identity already resolved from transport/proxy policy.
func (l *requestLimiter) allow(remote string, publisher bool, now time.Time) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.nextSweep.IsZero() || !now.Before(l.nextSweep) {
		for key, bucket := range l.clients {
			if now.Sub(bucket.seen) >= l.limits.Idle {
				delete(l.clients, key)
				if len(key) >= 7 && key[:7] == "public:" {
					l.publicClients--
				}
			}
		}
		l.nextSweep = now.Add(time.Second)
	}
	key := "public:" + peerIdentity(remote)
	rate := l.limits.PublicRate
	burst := l.limits.PublicBurst
	if publisher {
		key = "publisher:" + peerIdentity(remote)
		rate = l.limits.PublisherRate
		burst = l.limits.PublisherBurst
	}
	bucket, ok := l.clients[key]
	if !ok {
		reserved := max(1, min(64, l.limits.Clients/8))
		if len(l.clients) >= l.limits.Clients || !publisher && l.publicClients >= l.limits.Clients-reserved {
			return false, 1
		}
		if !publisher {
			l.publicClients++
		}
		bucket = clientBucket{tokens: float64(burst), updated: now, seen: now}
	}
	elapsed := now.Sub(bucket.updated).Seconds()
	if elapsed < 0 {
		elapsed = 0
	}
	bucket.tokens = min(float64(burst), bucket.tokens+elapsed*rate)
	bucket.updated = now
	bucket.seen = now
	retry := 1
	allowed := bucket.tokens >= 1
	if allowed {
		bucket.tokens--
	} else {
		retry = int((1-bucket.tokens)/rate) + 1
	}
	l.clients[key] = bucket
	return allowed, retry
}
