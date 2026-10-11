package analytics

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOriginClassification(t *testing.T) {
	cases := []struct {
		site, fetch, origin, ref, ua string
		want                         int
	}{
		{"https://wasm.fyi", "same-origin", "https://wasm.fyi", "", "Chrome/129", 0},
		{"https://wasm.fyi", "same-site", "", "https://wasm.fyi/benchmarks", "Firefox/130", 0},
		{"https://wasm.fyi", "same-origin", "https://wasm.fyi.evil.test", "", "Chrome/129", 1},
		{"https://wasm.fyi", "cross-site", "https://wasm.fyi", "", "curl/8", 1},
		{"http://localhost:8080", "same-origin", "http://localhost:8081", "", "Chrome/129", 1},
		{"https://wasm.fyi", "same-origin", "https://wasm.fyi", "", "Googlebot/2.1", 2},
		{"https://wasm.fyi", "", "", "", "GPTBot/1.2", 2},
		{"https://wasm.fyi", "", "", "", "python-requests/2.32.1", 1},
	}
	for _, c := range cases {
		if got := Classify(c.site, c.fetch, c.origin, c.ref, c.ua); got != c.want {
			t.Errorf("%+v got %d", c, got)
		}
	}
}
func TestDailySaltRotation(t *testing.T) {
	var salt Salt
	day := time.Date(2026, 10, 10, 23, 59, 59, 0, time.UTC)
	a := salt.Identity(day, "192.0.2.42", "Chrome/129")
	b := salt.Identity(day, "192.0.2.42", "Chrome/130")
	if len(a) != 16 || !bytes.Equal(a, b) {
		t.Fatal("visitor identity must use family, not full UA or version")
	}
	c := salt.Identity(day.Add(time.Second), "192.0.2.42", "Chrome/129")
	if bytes.Equal(a, c) {
		t.Fatal("visitor linked across UTC days")
	}
	if salt.Identity(day, "192.0.2.42", "Chrome/129") != nil {
		t.Fatal("late previous-day timestamp rotated salt backward")
	}
	if !bytes.Equal(c, salt.Identity(day.Add(time.Second), "192.0.2.42", "Chrome/129")) {
		t.Fatal("late completion corrupted current-day salt")
	}
	var restart Salt
	if bytes.Equal(c, restart.Identity(day.Add(time.Second), "192.0.2.42", "Chrome/129")) {
		t.Fatal("salt survived restart")
	}
}
func TestSanitization(t *testing.T) {
	for _, p := range []string{"/api/not-a-route/secret", "/strange/192.0.2.1", "/token/abc", "/api/summary?token=secret"} {
		if CleanPath(p) != "/other" {
			t.Fatalf("unsafe path retained: %s", p)
		}
	}
	if ReferrerHost("http://192.0.2.1/a") != "Direct / none" {
		t.Fatal("raw referrer IP retained")
	}
	if got, _, _ := Family(strings.Repeat("secret", 100)); got != "Other" {
		t.Fatal("unrecognized raw UA retained")
	}
}
func TestRetentionAndForeverTotals(t *testing.T) {
	s, err := Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().UTC()
	old := now.Add(-31 * 24 * time.Hour)
	events := []Event{{At: old, ID: []byte("old-private-id!!"), Pageview: true, Path: "/", Agent: "Chrome/1", Browser: "Chrome", Device: "Desktop", Referrer: "Direct / none", Down: 10}, {At: old, API: true, Origin: 1, Status: 200, Method: "GET", Path: "/api/summary", Agent: "curl/8", Network: "AS1 Example", Down: 100, Up: 3}, {At: now, ID: []byte("new-private-id!!"), Pageview: true, Path: "/", Agent: "Chrome/1", Browser: "Chrome", Device: "Desktop", Referrer: "Direct / none", Down: 20}, {At: now, API: true, Origin: 1, Status: 500, Method: "GET", Path: "/api/summary", Agent: "curl/8", Network: "AS1 Example", Down: 200, Up: 5}}
	if err = s.write(events); err != nil {
		t.Fatal(err)
	}
	before, err := s.Totals(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if before.Visitors != 2 || before.Pageviews != 2 || before.APIRequests != 2 || before.Clients != 1 || before.TotalDown != 330 || before.TotalUp != 8 {
		t.Fatalf("wrong totals: %+v", before)
	}
	if err = s.Prune(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"buckets", "facts", "seen", "place_seen"} {
		var n int
		if err = s.read.QueryRow("SELECT count(*) FROM "+table+" WHERE t<?", now.Add(-30*24*time.Hour).Unix()).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s stale=%d err=%v", table, n, err)
		}
	}
	var raw int
	if err = s.read.QueryRow("SELECT count(*) FROM events WHERE at<?", now.Add(-48*time.Hour).UnixMilli()).Scan(&raw); err != nil || raw != 0 {
		t.Fatal("raw event retention", raw, err)
	}
	if err = s.write([]Event{{At: now, API: true, Origin: 1, Status: 200, Method: "GET", Path: "/api/summary", Agent: "curl/8", Network: "AS1 Example", Down: 300}}); err != nil {
		t.Fatal(err)
	}
	s.cacheMu.Lock()
	clear(s.cache)
	s.cacheMu.Unlock()
	after, err := s.Totals(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if after.APIRequests != 3 || after.Pageviews != 2 || after.Visitors != 2 || after.TotalDown != 630 || after.Clients != 1 || after.Since != before.Since {
		t.Fatalf("pruning reset counters: %+v", after)
	}
}
func TestSparseHistogram(t *testing.T) {
	h := mergeHist(hist(10), hist(100))
	if len(h) > 12 {
		t.Fatalf("sparse histogram bloated: %d", len(h))
	}
	if percentile(h, .5) < 10 || percentile(h, .95) < 100 {
		t.Fatal("quantile underestimates bucket bound")
	}
}
func TestNumericPinSurvivesRenameAndRetention(t *testing.T) {
	s, err := Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	ok, err := s.Allow(ctx, []string{"JairusSW"}, "JairusSW", 42)
	if err != nil || !ok {
		t.Fatal(ok, err)
	}
	ok, err = s.Allow(ctx, []string{"JairusSW"}, "renamed", 42)
	if err != nil || !ok {
		t.Fatal("rename rejected", ok, err)
	}
	ok, err = s.Allow(ctx, []string{"JairusSW"}, "JairusSW", 43)
	if err != nil || ok {
		t.Fatal("renamed login taken by another numeric ID", ok, err)
	}
	if err = s.Prune(ctx, time.Now().Add(90*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if !s.Pinned(ctx, []string{"JairusSW"}, 42) || s.Pinned(ctx, []string{"someoneelse"}, 42) {
		t.Fatal("pin/allowlist mismatch")
	}
}
func TestQueueDropsRatherThanBlocks(t *testing.T) {
	s := &Store{queue: make(chan Input, 1)}
	s.Enqueue(Input{})
	done := make(chan struct{})
	go func() { s.Enqueue(Input{}); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("enqueue blocked")
	}
	if s.Dropped() != 1 {
		t.Fatal("drop not counted")
	}
}

func TestRealClientEndpointSparkAndDistinctPlaces(t *testing.T) {
	s, err := Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().UTC()
	page := Event{At: now, ID: []byte("one-visitor-id!!"), Origin: 0, Pageview: true, Path: "/bench/…", Agent: "Chrome/100", Browser: "Chrome", Device: "Desktop", Referrer: "github.com", Geo: true, City: "Example City", Country: "Example Country", Lat: 12.3, Lon: 45.6}
	e := Event{At: now, Origin: 1, API: true, Status: 200, Method: "GET", Path: "/api/matrix", Agent: "curl/8", Network: "AS42 Organization", MS: 12, Down: 10}
	other := e
	other.Path = "/api/summary"
	other.MS = 30
	other.Network = "AS42 Renamed organization"
	if err = s.write([]Event{page, page, e, e, other}); err != nil {
		t.Fatal(err)
	}
	a, err := s.Analytics(context.Background(), "24h", now)
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Clients) != 1 || a.Clients[0].Requests != 3 || a.Clients[0].TopEndpoint != "/api/matrix" || a.Clients[0].Network != "AS42" {
		t.Fatalf("real client aggregation: %+v", a.Clients)
	}
	sum := float64(0)
	for _, n := range a.Clients[0].Spark {
		sum += n
	}
	if sum != 3 {
		t.Fatal("client spark not from request counters", sum)
	}
	if len(a.Places) != 1 || a.Places[0].Visitors != 1 {
		t.Fatal("place pageviews mistaken for distinct visitors", a.Places)
	}
	totals, err := s.Totals(context.Background())
	if err != nil || totals.Clients != 1 || totals.Pageviews != 2 {
		t.Fatal("organization rename duplicated identity", totals, err)
	}
	for _, k := range a.KPIs {
		if k.ComparisonAvailable {
			t.Fatal("previous period fabricated on startup")
		}
		if (k.Key == "session" || k.Key == "bounce") && k.Available {
			t.Fatal("uncollected metric invented")
		}
	}
}

func TestSixHourVisitorSeriesDeduplicatesHourlyIdentities(t *testing.T) {
	s, err := Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().UTC()
	bucket := now.Unix()/21600*21600 - 21600
	events := make([]Event, 3)
	for i := range events {
		events[i] = Event{At: time.Unix(bucket+900+int64(i)*3600, 0), ID: []byte("same-daily-id!!!"), Pageview: true, Path: "/", Agent: "Chrome/100", Browser: "Chrome", Device: "Desktop", Referrer: "Direct / none"}
	}
	if err = s.write(events); err != nil {
		t.Fatal(err)
	}
	a, err := s.Analytics(context.Background(), "7d", now)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range a.Series {
		if p.At == bucket*1000 {
			found = true
			if p.Visitors != 1 || p.Pageviews != 3 {
				t.Fatalf("hourly sets summed instead of deduplicated: %+v", p)
			}
		}
	}
	if !found {
		t.Fatal("expected six-hour point missing")
	}
}

func TestLiveContainsOnlyBandwidthAndViewsRemain(t *testing.T) {
	s, err := Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().UTC().Truncate(time.Second)
	event := Event{At: now.Add(-time.Second), ID: []byte("one-private-id!!"), Pageview: true, Path: "/", Agent: "Chrome/100", Browser: "Chrome", Device: "Desktop", Down: 42, Up: 7, Geo: true, City: "Example", Country: "Example", Lat: 1, Lon: 2}
	s.observeLive(event)
	live := s.Live(now)
	if live.Rate.Down != 42 || live.Rate.Up != 7 {
		t.Fatalf("bandwidth lost: %+v", live)
	}
	body, err := json.Marshal(live)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]json.RawMessage
	if err = json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload) != 1 || payload["rate"] == nil {
		t.Fatalf("presence leaked into live payload: %s", body)
	}
	if err = s.write([]Event{event, event}); err != nil {
		t.Fatal(err)
	}
	total, err := s.Totals(context.Background())
	if err != nil || total.Pageviews != 2 || total.Visitors != 1 {
		t.Fatalf("views lost: %+v %v", total, err)
	}
	a, err := s.Analytics(context.Background(), "24h", now)
	if err != nil {
		t.Fatal(err)
	}
	body, err = json.Marshal(a)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"liveNow"`, `"livePages"`, `"pings"`} {
		if strings.Contains(string(body), field) {
			t.Fatalf("presence leaked into analytics: %s", field)
		}
	}
}

func TestGeoFallbackWithInstalledDBIP(t *testing.T) {
	dir := os.Getenv("WASMFYI_TEST_DBIP_DIR")
	if dir == "" {
		t.Skip("set WASMFYI_TEST_DBIP_DIR to installed DB-IP city/ASN files")
	}
	fixture := t.TempDir()
	for _, name := range []string{"dbip-city-lite.mmdb", "dbip-asn-lite.mmdb"} {
		// Symlinks avoid copying large MMDBs; lookup is read-only.
		if err := os.Symlink(filepath.Join(dir, name), filepath.Join(fixture, name)); err != nil {
			t.Fatal(err)
		}
	}
	g := openGeo(fixture)
	defer g.close()
	if g.city == nil || g.asn == nil {
		t.Fatal("DB-IP fallback not opened")
	}
	e := Event{}
	g.enrich(&e, "8.8.8.8")
	if !e.Geo || e.City == "" || !strings.HasPrefix(e.Network, "AS") {
		t.Fatalf("DB-IP schema lookup failed: %+v", e)
	}
}
