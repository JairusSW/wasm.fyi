package analytics

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net"
	"net/url"
	routePath "path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oschwald/maxminddb-golang"
)

// Salt is deliberately never persisted. Restarting also breaks visitor linkage.
type Salt struct {
	mu  sync.Mutex
	day string
	key [32]byte
}

func (s *Salt) Identity(now time.Time, ip, family string) []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	day := now.UTC().Format("2006-01-02")
	if s.day != "" && day < s.day {
		return nil
	}
	if day != s.day {
		if _, err := rand.Read(s.key[:]); err != nil {
			return nil
		}
		s.day = day
	}
	m := hmac.New(sha256.New, s.key[:])
	m.Write([]byte(ip))
	m.Write([]byte{0})
	m.Write([]byte(strings.Split(family, "/")[0]))
	return m.Sum(nil)[:16]
}

var versionRE = regexp.MustCompile(`^[0-9]{1,3}`)
var knownAgents = []string{"Googlebot", "bingbot", "GPTBot", "ClaudeBot", "PerplexityBot", "CCBot", "Applebot", "Bytespider", "DuckDuckBot", "facebookexternalhit", "Twitterbot", "Amazonbot", "python-requests", "python-httpx", "curl", "Wget", "Go-http-client", "undici", "node", "Edg", "Firefox", "Chrome", "Version"}

func Family(ua string) (agent, browser string, bot bool) {
	if len(ua) > 512 {
		ua = ua[:512]
	}
	lower := strings.ToLower(ua)
	for i, name := range knownAgents {
		at := strings.Index(lower, strings.ToLower(name))
		if at < 0 {
			continue
		}
		major := ""
		rest := ua[at+len(name):]
		if strings.HasPrefix(rest, "/") {
			major = versionRE.FindString(rest[1:])
		}
		agent = name
		if major != "" {
			agent += "/" + major
		}
		bot = i < 12
		browser = name
		if name == "Version" {
			browser = "Safari"
			agent = "Safari"
			if major != "" {
				agent += "/" + major
			}
		}
		return
	}
	return "Other", "Other", false
}
func Classify(site, fetchSite, origin, referrer, ua string) int {
	_, _, bot := Family(ua)
	if bot {
		return 2
	}
	if fetchSite == "same-origin" || fetchSite == "same-site" {
		source := origin
		if source == "" {
			source = referrer
		}
		a, e := url.Parse(source)
		b, _ := url.Parse(site)
		if e == nil && a.User == nil && a.Host == b.Host && a.Scheme == b.Scheme {
			return 0
		}
	}
	return 1
}
func CleanPath(p string) string {
	// Only route templates are retained, never arbitrary user-provided segments.
	p = strings.TrimSuffix(p, "/")
	if p == "" {
		return "/"
	}
	switch p {
	case "/benchmarks", "/history", "/features", "/compare", "/health", "/simd", "/gc", "/memory64", "/threads", "/dashboard", "/api/summary", "/api/overview", "/api/platforms", "/api/aggregates", "/api/matrix", "/api/timeline", "/api/observation", "/api/benchmarks", "/api/history", "/api/history/summary", "/api/history/comparison", "/api/history/report", "/api/captures", "/api/health", "/data/llm/index.json":
		return p
	}
	if strings.HasPrefix(p, "/bench/") {
		return "/bench/…"
	}
	if strings.HasPrefix(p, "/api/v1/") {
		parts := strings.Split(p, "/")
		if len(parts) > 3 {
			switch parts[3] {
			case "artifacts", "reports", "results", "files", "archives", "summary":
				return "/api/v1/" + parts[3] + "/…"
			}
		}
	}
	if strings.HasPrefix(p, "/data/") {
		return "/data/…"
	}
	if strings.HasPrefix(p, "/_app/") {
		return "/_app/…"
	}
	return "/other"
}
func ReferrerHost(v string) string {
	u, e := url.Parse(v)
	if e != nil || u.Hostname() == "" || net.ParseIP(u.Hostname()) != nil || len(u.Hostname()) > 120 {
		return "Direct / none"
	}
	return strings.ToLower(u.Hostname())
}
func Device(ua string) string {
	s := strings.ToLower(ua)
	if strings.Contains(s, "ipad") || strings.Contains(s, "tablet") {
		return "Tablet"
	}
	if strings.Contains(s, "mobile") || strings.Contains(s, "android") {
		return "Mobile"
	}
	return "Desktop"
}

type geo struct{ city, asn *maxminddb.Reader }

func openGeo(dir string) *geo {
	g := &geo{}
	if dir != "" {
		g.city = openGeoFile(dir, "GeoLite2-City.mmdb", "dbip-city-lite.mmdb")
		g.asn = openGeoFile(dir, "GeoLite2-ASN.mmdb", "dbip-asn-lite.mmdb")
	}
	return g
}
func openGeoFile(dir string, names ...string) *maxminddb.Reader {
	for _, name := range names {
		if reader, err := maxminddb.Open(filepath.Join(dir, name)); err == nil {
			return reader
		}
	}
	return nil
}

func (g *geo) close() {
	if g.city != nil {
		g.city.Close()
	}
	if g.asn != nil {
		g.asn.Close()
	}
}
func (g *geo) enrich(e *Event, ip string) {
	addr := net.ParseIP(ip)
	if addr == nil {
		return
	}
	if g.city != nil {
		var v struct {
			City struct {
				Names map[string]string `maxminddb:"names"`
			} `maxminddb:"city"`
			Country struct {
				Names map[string]string `maxminddb:"names"`
			} `maxminddb:"country"`
			Location struct {
				Latitude  float64 `maxminddb:"latitude"`
				Longitude float64 `maxminddb:"longitude"`
			} `maxminddb:"location"`
		}
		if g.city.Lookup(addr, &v) == nil && v.City.Names["en"] != "" {
			e.City = v.City.Names["en"]
			e.Country = v.Country.Names["en"]
			e.Lat = math.Round(v.Location.Latitude*10) / 10
			e.Lon = math.Round(v.Location.Longitude*10) / 10
			e.Geo = true
		}
	}
	if g.asn != nil {
		var v struct {
			Number       uint   `maxminddb:"autonomous_system_number"`
			Organization string `maxminddb:"autonomous_system_organization"`
		}
		if g.asn.Lookup(addr, &v) == nil && v.Number > 0 {
			e.Network = "AS" + strconv.FormatUint(uint64(v.Number), 10) + " " + v.Organization
		}
	}
	if e.Network == "" {
		e.Network = "Unknown network"
	}
}

// DNS work has its own bounded worker. A name is never verified from ASN alone:
// reverse suffix AND forward-confirmed IP are both required. No IP is persisted.
type verification struct{ key, ip, family string }
type verifier struct {
	mu       sync.Mutex
	verified map[string]time.Time
	pending  map[string]bool
	queue    chan verification
	stop     chan struct{}
	done     chan struct{}
}

func newVerifier() *verifier {
	v := &verifier{verified: map[string]time.Time{}, pending: map[string]bool{}, queue: make(chan verification, 128), stop: make(chan struct{}), done: make(chan struct{})}
	go v.run()
	return v
}
func (v *verifier) check(ip, agent string) bool {
	family, _, bot := Family(agent)
	if !bot {
		return false
	}
	sum := sha256.Sum256([]byte(ip + "\x00" + family))
	key := hex.EncodeToString(sum[:16])
	v.mu.Lock()
	defer v.mu.Unlock()
	if until, ok := v.verified[key]; ok && time.Now().Before(until) {
		return true
	}
	if !v.pending[key] && len(v.pending) < 128 {
		select {
		case v.queue <- verification{key, ip, family}:
			v.pending[key] = true
		default:
		}
	}
	return false
}
func (v *verifier) run() {
	defer close(v.done)
	for {
		select {
		case <-v.stop:
			return
		case item := <-v.queue:
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			ok := verifyDNS(ctx, item.ip, item.family)
			cancel()
			v.mu.Lock()
			delete(v.pending, item.key)
			if len(v.verified) > 2048 {
				clear(v.verified)
			}
			if ok {
				v.verified[item.key] = time.Now().Add(time.Hour)
			}
			v.mu.Unlock()
		}
	}
}
func verifyDNS(ctx context.Context, ip, family string) bool {
	var suffixes []string
	switch strings.Split(family, "/")[0] {
	case "Googlebot":
		suffixes = []string{".googlebot.com", ".google.com"}
	case "bingbot":
		suffixes = []string{".search.msn.com"}
	case "Applebot":
		suffixes = []string{".applebot.apple.com"}
	default:
		return false
	}
	names, e := net.DefaultResolver.LookupAddr(ctx, ip)
	if e != nil {
		return false
	}
	want := net.ParseIP(ip)
	for _, name := range names {
		name = strings.TrimSuffix(strings.ToLower(name), ".")
		match := false
		for _, suffix := range suffixes {
			match = match || strings.HasSuffix(name, suffix)
		}
		if !match {
			continue
		}
		ips, e := net.DefaultResolver.LookupIPAddr(ctx, name)
		if e != nil {
			continue
		}
		for _, a := range ips {
			if a.IP.Equal(want) {
				return true
			}
		}
	}
	return false
}

func ValidPagePath(p string) bool {
	return len(p) > 0 && len(p) <= 512 && strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "//") && !strings.ContainsAny(p, "\\\x00\r\n?#") && (routePath.Clean(p) == strings.TrimSuffix(p, "/") || p == "/")
}
