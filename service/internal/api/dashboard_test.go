package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/analytics"
)

func dashboardFixture(t *testing.T) *API {
	t.Helper()
	db, e := analytics.Open(t.TempDir(), "")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	d := &dashboard{analytics: db, secret: []byte(strings.Repeat("s", 32)), origin: "https://wasm.fyi", clientID: "test-client", clientSecret: "test-secret", aliases: []string{"JairusSW"}, client: &http.Client{Timeout: time.Second}, states: map[string]int64{}, streams: make(chan struct{}, 8)}
	return &API{dashboard: d, limiter: newRequestLimiter(DefaultRequestLimits())}
}
func TestDashboardSessionAuthorization(t *testing.T) {
	a := dashboardFixture(t)
	r := httptest.NewRequest("GET", "https://wasm.fyi/api/admin/totals", nil)
	w := httptest.NewRecorder()
	a.dashboardRequest(w, r)
	if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("anonymous admin read", w.Code, w.Header())
	}
	if ok, e := a.dashboard.analytics.Allow(context.Background(), a.dashboard.aliases, "wrong-login", 42); e != nil || ok {
		t.Fatal("wrong login allowed", ok, e)
	}
	ok, e := a.dashboard.analytics.Allow(context.Background(), a.dashboard.aliases, "JairusSW", 42)
	if e != nil || !ok {
		t.Fatal(ok, e)
	}
	s := adminSession{42, "JairusSW", "", time.Now().Add(time.Hour).Unix(), "nonce"}
	r = httptest.NewRequest("GET", "https://wasm.fyi/auth/me", nil)
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: a.dashboard.sign("session", s)})
	w = httptest.NewRecorder()
	a.dashboardRequest(w, r)
	if w.Code != 200 {
		t.Fatal("allowed login rejected", w.Code)
	}
	a.dashboard.aliases = []string{"someoneelse"}
	w = httptest.NewRecorder()
	a.dashboardRequest(w, r)
	if w.Code != 401 {
		t.Fatal("removed allowlist entry retained access", w.Code)
	}
}
func TestOAuthCallbackWrongAndAllowedLogin(t *testing.T) {
	for _, login := range []string{"intruder", "JairusSW"} {
		t.Run(login, func(t *testing.T) {
			a := dashboardFixture(t)
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" {
					r.ParseForm()
					if r.Form.Get("code_verifier") != "pkce-verifier" {
						t.Error("missing PKCE verifier")
					}
					json.NewEncoder(w).Encode(map[string]string{"access_token": "not-persisted", "scope": ""})
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"id": 42, "login": login, "avatar_url": "https://avatars.githubusercontent.com/u/42"})
			}))
			defer provider.Close()
			a.dashboard.tokenURL = provider.URL + "/token"
			a.dashboard.userURL = provider.URL + "/user"
			state := oauthState{"pkce-verifier", "nonce", time.Now().Add(time.Minute).Unix()}
			a.dashboard.states[state.Nonce] = state.Expires
			r := httptest.NewRequest("GET", "https://wasm.fyi/auth/github/callback?code=code&state=nonce", nil)
			r.AddCookie(&http.Cookie{Name: stateCookie, Value: a.dashboard.sign("state", state)})
			w := httptest.NewRecorder()
			a.dashboardRequest(w, r)
			want := 403
			if login == "JairusSW" {
				want = 303
			}
			if w.Code != want {
				t.Fatal("callback", w.Code, w.Body.String())
			}
			if login == "JairusSW" {
				var session *http.Cookie
				for _, c := range w.Result().Cookies() {
					if c.Name == sessionCookie {
						session = c
					}
				}
				if session == nil || !session.Secure || !session.HttpOnly || session.SameSite != http.SameSiteLaxMode || session.MaxAge != 604800 {
					t.Fatal("insecure/missing session cookie", session)
				}
				me := httptest.NewRequest("GET", "https://wasm.fyi/auth/me", nil)
				me.AddCookie(session)
				mw := httptest.NewRecorder()
				a.dashboardRequest(mw, me)
				if mw.Code != 200 {
					t.Fatal("new session rejected", mw.Code)
				}
			}
			again := httptest.NewRecorder()
			a.dashboardRequest(again, r)
			if again.Code != 400 {
				t.Fatal("OAuth state replay accepted", again.Code)
			}
		})
	}
}
func TestLogoutCSRFAndRevocation(t *testing.T) {
	a := dashboardFixture(t)
	ok, e := a.dashboard.analytics.Allow(context.Background(), a.dashboard.aliases, "JairusSW", 42)
	if e != nil || !ok {
		t.Fatal(e)
	}
	s := adminSession{42, "JairusSW", "", time.Now().Add(time.Hour).Unix(), "revocable"}
	cookie := &http.Cookie{Name: sessionCookie, Value: a.dashboard.sign("session", s)}
	r := httptest.NewRequest("POST", "https://wasm.fyi/auth/logout", nil)
	r.AddCookie(cookie)
	r.Header.Set("Origin", "https://evil.test")
	w := httptest.NewRecorder()
	a.dashboardRequest(w, r)
	if w.Code != 403 {
		t.Fatal("CSRF logout accepted", w.Code)
	}
	r.Header.Set("Origin", "https://wasm.fyi")
	w = httptest.NewRecorder()
	a.dashboardRequest(w, r)
	if w.Code != 204 {
		t.Fatal(w.Code)
	}
	me := httptest.NewRequest("GET", "https://wasm.fyi/auth/me", nil)
	me.AddCookie(cookie)
	w = httptest.NewRecorder()
	a.dashboardRequest(w, me)
	if w.Code != 401 {
		t.Fatal("logged-out cookie reusable", w.Code)
	}
}
func TestOAuthStateAndRedirect(t *testing.T) {
	a := dashboardFixture(t)
	a.dashboard.authorizeURL = "https://github.com/login/oauth/authorize"
	r := httptest.NewRequest("GET", "https://evil.test/auth/github/login", nil)
	w := httptest.NewRecorder()
	a.dashboardRequest(w, r)
	u, e := url.Parse(w.Header().Get("Location"))
	if e != nil || u.Query().Get("redirect_uri") != "https://wasm.fyi/auth/github/callback" || u.Query().Get("scope") != "" || u.Query().Get("code_challenge_method") != "S256" || u.Query().Get("code_challenge") == "" {
		t.Fatal("unsafe OAuth redirect", u, e)
	}
	cb := httptest.NewRequest("GET", "https://wasm.fyi/auth/github/callback?state=wrong&code=x", nil)
	for _, c := range w.Result().Cookies() {
		cb.AddCookie(c)
	}
	cw := httptest.NewRecorder()
	a.dashboardRequest(cw, cb)
	if cw.Code != 400 {
		t.Fatal("wrong state accepted", cw.Code)
	}
}
func TestBeaconPrivacyAndValidation(t *testing.T) {
	a := dashboardFixture(t)
	cases := []struct {
		body, origin, dnt, gpc string
		status                 int
	}{{`{"path":"/","referrer":"github.com","screen":"Desktop"}`, "https://evil.test", "", "", 403}, {`{"path":"/","referrer":"github.com","screen":"Desktop"}`, "https://wasm.fyi", "1", "", 204}, {`{"path":"/","referrer":"github.com","screen":"Desktop"}`, "https://wasm.fyi", "", "1", 204}, {`{"path":"/secret/token","referrer":"","screen":"Desktop"}`, "https://wasm.fyi", "", "", 400}, {`{"path":"/","referrer":"github.com","screen":"Desktop"}`, "https://wasm.fyi", "", "", 204}, {strings.Repeat("x", 1025), "https://wasm.fyi", "", "", 400}}
	for _, c := range cases {
		r := httptest.NewRequest("POST", "https://wasm.fyi/api/event", strings.NewReader(c.body))
		r.Header.Set("Origin", c.origin)
		r.Header.Set("DNT", c.dnt)
		r.Header.Set("Sec-GPC", c.gpc)
		w := httptest.NewRecorder()
		a.dashboardRequest(w, r)
		if w.Code != c.status {
			t.Fatalf("beacon expected%d got%d", c.status, w.Code)
		}
	}
}

func TestSessionTamperAndExpiry(t *testing.T) {
	a := dashboardFixture(t)
	ok, e := a.dashboard.analytics.Allow(context.Background(), a.dashboard.aliases, "JairusSW", 42)
	if e != nil || !ok {
		t.Fatal(e)
	}
	for _, s := range []adminSession{{42, "JairusSW", "", time.Now().Add(-time.Second).Unix(), "expired"}, {43, "JairusSW", "", time.Now().Add(time.Hour).Unix(), "unpinned"}} {
		r := httptest.NewRequest("GET", "https://wasm.fyi/api/admin/analytics", nil)
		r.AddCookie(&http.Cookie{Name: sessionCookie, Value: a.dashboard.sign("session", s)})
		w := httptest.NewRecorder()
		a.dashboardRequest(w, r)
		if w.Code != 401 {
			t.Fatal("invalid session admitted", w.Code)
		}
	}
	s := adminSession{42, "JairusSW", "", time.Now().Add(time.Hour).Unix(), "tampered"}
	r := httptest.NewRequest("GET", "https://wasm.fyi/api/admin/totals", nil)
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: a.dashboard.sign("session", s) + "x"})
	w := httptest.NewRecorder()
	a.dashboardRequest(w, r)
	if w.Code != 401 {
		t.Fatal("tampered session admitted", w.Code)
	}
}

func TestLegitimateNavigationBeaconAndMissingConfig(t *testing.T) {
	a := dashboardFixture(t)
	for _, path := range []string{"/bench/applications/sqlite", "/simd", "/gc", "/threads", "/benchmarks/"} {
		body := `{"path":"` + path + `","referrer":"github.com","screen":"Desktop"}`
		r := httptest.NewRequest("POST", "https://wasm.fyi/api/event", strings.NewReader(body))
		r.Header.Set("Origin", "https://wasm.fyi")
		w := httptest.NewRecorder()
		a.dashboardRequest(w, r)
		if w.Code != 204 {
			t.Fatal("legitimate navigation rejected", path, w.Code)
		}
	}
	a.dashboard.clientID = ""
	a.dashboard.clientSecret = ""
	r := httptest.NewRequest("GET", "https://wasm.fyi/auth/me", nil)
	w := httptest.NewRecorder()
	a.dashboardRequest(w, r)
	var result map[string]any
	if w.Code != 401 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result["configured"] != false {
		t.Fatal("missing OAuth config not represented", w.Code, w.Body.String())
	}
}

func TestDevelopmentAuthRequiresLoopbackTransportClientAndHost(t *testing.T) {
	a := dashboardFixture(t)
	a.dashboard.development = true
	a.dashboard.origin = "http://localhost:8788"
	a.dashboard.limiter = a.limiter
	cases := []struct {
		remote, host, forwarded string
		trusted                 bool
		want                    int
	}{{"127.0.0.1:1234", "localhost:8788", "", false, 200}, {"192.0.2.1:1234", "localhost:8788", "127.0.0.1", false, 401}, {"127.0.0.1:1234", "wasm.fyi", "", false, 401}, {"127.0.0.1:1234", "localhost:8788", "192.0.2.1", true, 401}, {"127.0.0.1:1234", "localhost:8788", "127.0.0.1", true, 200}}
	for _, c := range cases {
		limits := DefaultRequestLimits()
		if c.trusted {
			p, e := netip.ParsePrefix("127.0.0.1/32")
			if e != nil {
				t.Fatal(e)
			}
			limits.TrustedProxies = []netip.Prefix{p}
		}
		a.limiter = newRequestLimiter(limits)
		a.dashboard.limiter = a.limiter
		r := httptest.NewRequest("GET", "http://"+c.host+"/auth/me", nil)
		r.RemoteAddr = c.remote
		r.Header.Set("X-Real-IP", c.forwarded)
		w := httptest.NewRecorder()
		a.dashboardRequest(w, r)
		if w.Code != c.want {
			t.Fatalf("%+v got%d", c, w.Code)
		}
	}
	r := httptest.NewRequest("POST", "http://localhost:8788/admin/v1/imports", nil)
	if a.dashboardRequest(httptest.NewRecorder(), r) {
		t.Fatal("development auth intercepted publishing route")
	}
}
func TestDevelopmentAuthRejectsProductionConfiguration(t *testing.T) {
	for _, c := range []struct{ origin, listen string }{{"https://wasm.fyi", "127.0.0.1:8090"}, {"http://localhost:8788", "0.0.0.0:8789"}, {"http://localhost:8788", "localhost:8789"}} {
		t.Run(c.origin+c.listen, func(t *testing.T) {
			t.Setenv("WASMFYI_DEV_ADMIN", "1")
			t.Setenv("WASMFYI_DASHBOARD_ORIGIN", c.origin)
			a := &API{limiter: newRequestLimiter(DefaultRequestLimits())}
			if err := a.EnableDashboard(t.TempDir(), c.listen); err == nil {
				a.Close()
				t.Fatal("development auth enabled outside literal loopback bind/origin")
			}
		})
	}
}
