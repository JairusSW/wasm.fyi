package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/analytics"
)

const sessionCookie = "__Host-wasmfyi-admin"
const stateCookie = "__Host-wasmfyi-oauth-state"

type dashboard struct {
	analytics                       *analytics.Store
	secret                          []byte
	origin                          string
	clientID, clientSecret          string
	aliases                         []string
	client                          *http.Client
	authorizeURL, tokenURL, userURL string
	mu                              sync.Mutex
	states                          map[string]int64
	streams                         chan struct{}
	development                     bool
	limiter                         *requestLimiter
}
type adminSession struct {
	ID      int64  `json:"id"`
	Login   string `json:"login"`
	Avatar  string `json:"avatarUrl"`
	Expires int64  `json:"exp"`
	Nonce   string `json:"nonce"`
}
type oauthState struct {
	Verifier string `json:"verifier"`
	Nonce    string `json:"nonce"`
	Expires  int64  `json:"exp"`
}

// EnableDashboard opens only analytics.sqlite. Authentication has a separate
// signing secret; publishing tokens, cursor keys and benchmark files are untouched.
func (a *API) EnableDashboard(dataDirectory, listenAddress string) error {
	origin := os.Getenv("WASMFYI_DASHBOARD_ORIGIN")
	if origin == "" {
		origin = "https://wasm.fyi"
	}
	u, e := url.Parse(origin)
	if e != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Hostname() == "" || u.Path != "" && u.Path != "/" || u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1")) {
		return fmt.Errorf("invalid WASMFYI_DASHBOARD_ORIGIN")
	}
	origin = strings.TrimSuffix(origin, "/")
	development := os.Getenv("WASMFYI_DEV_ADMIN") == "1"
	if development {
		host, _, err := net.SplitHostPort(listenAddress)
		ip := net.ParseIP(host)
		originIP := net.ParseIP(u.Hostname())
		if err != nil || ip == nil || !ip.IsLoopback() || (u.Hostname() != "localhost" && (originIP == nil || !originIP.IsLoopback())) {
			return fmt.Errorf("WASMFYI_DEV_ADMIN is restricted to literal loopback listeners and loopback public origins")
		}
	}
	secret, e := dashboardSecret(dataDirectory)
	if e != nil {
		return e
	}
	store, e := analytics.Open(dataDirectory, os.Getenv("WASMFYI_GEOIP_DIR"))
	if e != nil {
		return e
	}
	aliases := strings.Split(os.Getenv("WASMFYI_ADMIN_GITHUB_LOGINS"), ",")
	if len(aliases) == 1 && aliases[0] == "" {
		aliases = []string{"JairusSW"}
	}
	for i := range aliases {
		aliases[i] = strings.TrimSpace(aliases[i])
		if aliases[i] == "" || len(aliases[i]) > 39 {
			store.Close()
			return fmt.Errorf("invalid admin GitHub allowlist")
		}
	}
	a.dashboard = &dashboard{analytics: store, secret: secret, origin: origin, clientID: os.Getenv("WASMFYI_GITHUB_CLIENT_ID"), clientSecret: os.Getenv("WASMFYI_GITHUB_CLIENT_SECRET"), aliases: aliases, client: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, authorizeURL: "https://github.com/login/oauth/authorize", tokenURL: "https://github.com/login/oauth/access_token", userURL: "https://api.github.com/user", states: map[string]int64{}, streams: make(chan struct{}, 8), development: development, limiter: a.limiter}
	return nil
}
func dashboardSecret(directory string) ([]byte, error) {
	if secret := os.Getenv("WASMFYI_SESSION_SECRET"); secret != "" {
		if len(secret) < 32 {
			return nil, fmt.Errorf("WASMFYI_SESSION_SECRET requires at least 32 bytes")
		}
		return []byte(secret), nil
	}
	path := os.Getenv("WASMFYI_SESSION_SECRET_FILE")
	if path == "" {
		path = filepath.Join(directory, "session-secret")
	}
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return nil, e
	}
	root, e := os.OpenRoot(filepath.Dir(path))
	if e != nil {
		return nil, e
	}
	defer root.Close()
	name := filepath.Base(path)
	if info, e := root.Lstat(name); e == nil {
		if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() != 32 {
			return nil, fmt.Errorf("session secret must be a private 32-byte regular file")
		}
		f, err := root.Open(name)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		opened, err := f.Stat()
		if err != nil || !os.SameFile(info, opened) || !opened.Mode().IsRegular() || opened.Mode().Perm()&0077 != 0 || opened.Size() != 32 {
			return nil, fmt.Errorf("session secret changed while opening")
		}
		secret, err := io.ReadAll(io.LimitReader(f, 33))
		if err != nil || len(secret) != 32 {
			return nil, fmt.Errorf("session secret must contain exactly 32 bytes")
		}
		return secret, nil
	} else if !errors.Is(e, os.ErrNotExist) {
		return nil, e
	}
	secret := make([]byte, 32)
	if _, e := rand.Read(secret); e != nil {
		return nil, e
	}
	f, e := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if errors.Is(e, os.ErrExist) {
		return dashboardSecret(directory)
	}
	if e != nil {
		return nil, e
	}
	_, e = f.Write(secret)
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil {
		return nil, e
	}
	if ce != nil {
		return nil, ce
	}
	return secret, nil
}
func randomNonce() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func (d *dashboard) sign(kind string, v any) string {
	b, _ := json.Marshal(v)
	m := hmac.New(sha256.New, d.secret)
	m.Write([]byte(kind + "\x00"))
	m.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
func (d *dashboard) parse(kind, token string, out any) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(token) > 2048 {
		return false
	}
	b, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return false
	}
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return false
	}
	m := hmac.New(sha256.New, d.secret)
	m.Write([]byte(kind + "\x00"))
	m.Write(b)
	return hmac.Equal(sig, m.Sum(nil)) && json.Unmarshal(b, out) == nil
}
func (d *dashboard) session(r *http.Request) (adminSession, bool) {
	if d.development {
		if d.developmentAllowed(r) {
			return adminSession{Login: "local-developer", Expires: time.Now().Add(7 * 24 * time.Hour).Unix()}, true
		}
		return adminSession{}, false
	}
	var s adminSession
	c, e := r.Cookie(sessionCookie)
	if e != nil || !d.parse("session", c.Value, &s) || s.Expires <= time.Now().Unix() || s.Expires > time.Now().Add(7*24*time.Hour+time.Minute).Unix() || s.Nonce == "" || !d.analytics.Pinned(r.Context(), d.aliases, s.ID) || d.analytics.Revoked(r.Context(), s.Nonce) {
		return s, false
	}
	return s, true
}
func adminJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func setAdminCookie(w http.ResponseWriter, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: age, Expires: time.Now().Add(time.Duration(age) * time.Second)})
}
func (d *dashboard) sameOrigin(r *http.Request) bool { return r.Header.Get("Origin") == d.origin }
func (a *API) dashboardRequest(w http.ResponseWriter, r *http.Request) bool {
	p := strings.TrimSuffix(r.URL.Path, "/")
	if !strings.HasPrefix(p, "/auth/") && !strings.HasPrefix(p, "/api/admin/") && p != "/api/event" {
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	d := a.dashboard
	client, e := a.limiter.clientIdentity(r, false)
	if e != nil {
		adminJSON(w, 400, map[string]string{"error": "invalid client address"})
		return true
	}
	if allowed, retry := a.limiter.allow(client, false, time.Now()); !allowed {
		w.Header().Set("Retry-After", fmt.Sprint(retry))
		adminJSON(w, 429, map[string]string{"error": "client request limit"})
		return true
	}
	if d == nil {
		adminJSON(w, 503, map[string]any{"error": "sign-in not configured", "configured": false})
		return true
	}
	if p == "/api/event" {
		if r.Method != "POST" {
			w.WriteHeader(405)
			return true
		}
		a.pageEvent(w, r)
		return true
	}
	if p == "/auth/me" && r.Method == "GET" {
		if s, ok := d.session(r); ok {
			adminJSON(w, 200, map[string]any{"login": s.Login, "avatarUrl": s.Avatar, "development": d.development})
		} else {
			adminJSON(w, 401, map[string]any{"error": "sign-in required", "configured": d.clientID != "" && d.clientSecret != ""})
		}
		return true
	}
	if p == "/auth/logout" && r.Method == "POST" {
		if !d.sameOrigin(r) {
			adminJSON(w, 403, map[string]string{"error": "same-origin request required"})
			return true
		}
		if s, ok := d.session(r); ok && !d.development {
			if e := d.analytics.Revoke(r.Context(), s.Nonce, s.Expires); e != nil {
				adminJSON(w, 503, map[string]string{"error": "logout unavailable"})
				return true
			}
		}
		setAdminCookie(w, sessionCookie, "", -1)
		setAdminCookie(w, stateCookie, "", -1)
		w.WriteHeader(204)
		return true
	}
	if p == "/auth/github/login" && r.Method == "GET" {
		d.login(w, r)
		return true
	}
	if p == "/auth/github/callback" && r.Method == "GET" {
		d.callback(w, r)
		return true
	}
	if strings.HasPrefix(p, "/auth/") {
		adminJSON(w, 404, map[string]string{"error": "unknown authentication endpoint"})
		return true
	}
	s, ok := d.session(r)
	if !ok {
		adminJSON(w, 401, map[string]string{"error": "sign-in required"})
		return true
	}
	allowedField := ""
	if p == "/api/admin/analytics" {
		allowedField = "range"
	}
	if p == "/api/admin/bandwidth" {
		allowedField = "window"
	}
	if len(r.URL.RawQuery) > 256 {
		adminJSON(w, 400, map[string]string{"error": "invalid query"})
		return true
	}
	for key, values := range r.URL.Query() {
		if key != allowedField || len(values) != 1 {
			adminJSON(w, 400, map[string]string{"error": "invalid query"})
			return true
		}
	}
	if r.Method != "GET" {
		w.WriteHeader(405)
		return true
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var v any
	var err error
	switch p {
	case "/api/admin/analytics":
		rangeName := r.URL.Query().Get("range")
		if rangeName == "" {
			rangeName = "24h"
		}
		if rangeName != "24h" && rangeName != "7d" && rangeName != "30d" {
			adminJSON(w, 400, map[string]string{"error": "invalid range"})
			return true
		}
		v, err = d.analytics.Analytics(ctx, rangeName, time.Now())
	case "/api/admin/bandwidth":
		window := r.URL.Query().Get("window")
		if window == "" {
			window = "1d"
		}
		if window != "1h" && window != "1d" && window != "1w" && window != "1m" {
			adminJSON(w, 400, map[string]string{"error": "invalid window"})
			return true
		}
		v, err = d.analytics.Bandwidth(ctx, window, time.Now())
	case "/api/admin/totals":
		v, err = d.analytics.Totals(ctx)
	case "/api/admin/live":
		d.stream(w, r, s)
		return true
	default:
		adminJSON(w, 404, map[string]string{"error": "unknown dashboard endpoint"})
		return true
	}
	if err != nil {
		adminJSON(w, 503, map[string]string{"error": "analytics temporarily unavailable"})
	} else {
		adminJSON(w, 200, v)
	}
	return true
}
func (d *dashboard) login(w http.ResponseWriter, r *http.Request) {
	if d.clientID == "" || d.clientSecret == "" {
		adminJSON(w, 503, map[string]any{"error": "sign-in not configured", "configured": false})
		return
	}
	nonce := randomNonce()
	verifier := randomNonce()
	if nonce == "" || verifier == "" {
		w.WriteHeader(503)
		return
	}
	challenge := sha256.Sum256([]byte(verifier))
	expiry := time.Now().Add(10 * time.Minute).Unix()
	d.mu.Lock()
	for key, exp := range d.states {
		if exp < time.Now().Unix() {
			delete(d.states, key)
		}
	}
	if len(d.states) >= 1024 {
		d.mu.Unlock()
		w.WriteHeader(429)
		return
	}
	d.states[nonce] = expiry
	d.mu.Unlock()
	setAdminCookie(w, stateCookie, d.sign("state", oauthState{verifier, nonce, expiry}), 600)
	q := url.Values{"client_id": {d.clientID}, "redirect_uri": {d.origin + "/auth/github/callback"}, "state": {nonce}, "scope": {""}, "allow_signup": {"false"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}, "code_challenge_method": {"S256"}}
	http.Redirect(w, r, d.authorizeURL+"?"+q.Encode(), 302)
}
func (d *dashboard) callback(w http.ResponseWriter, r *http.Request) {
	setAdminCookie(w, stateCookie, "", -1)
	var state oauthState
	c, e := r.Cookie(stateCookie)
	if e != nil || !d.parse("state", c.Value, &state) || state.Expires <= time.Now().Unix() || !hmac.Equal([]byte(state.Nonce), []byte(r.URL.Query().Get("state"))) {
		adminJSON(w, 400, map[string]string{"error": "invalid OAuth state"})
		return
	}
	d.mu.Lock()
	exp, ok := d.states[state.Nonce]
	delete(d.states, state.Nonce)
	d.mu.Unlock()
	code := r.URL.Query().Get("code")
	if !ok || exp <= time.Now().Unix() || code == "" || len(code) > 1024 {
		adminJSON(w, 400, map[string]string{"error": "expired OAuth state"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	body := url.Values{"client_id": {d.clientID}, "client_secret": {d.clientSecret}, "code": {code}, "code_verifier": {state.Verifier}, "redirect_uri": {d.origin + "/auth/github/callback"}}
	req, _ := http.NewRequestWithContext(ctx, "POST", d.tokenURL, strings.NewReader(body.Encode()))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var token struct {
		Access string `json:"access_token"`
		Scope  string `json:"scope"`
	}
	if !d.githubJSON(req, &token) || token.Access == "" || token.Scope != "" {
		adminJSON(w, 502, map[string]string{"error": "GitHub authorization failed; public-profile-only permission required"})
		return
	}
	req, _ = http.NewRequestWithContext(ctx, "GET", d.userURL, nil)
	req.Header.Set("Authorization", "Bearer "+token.Access)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	var user struct {
		ID     int64  `json:"id"`
		Login  string `json:"login"`
		Avatar string `json:"avatar_url"`
	}
	if !d.githubJSON(req, &user) {
		adminJSON(w, 502, map[string]string{"error": "GitHub profile unavailable"})
		return
	}
	token.Access = ""
	allowed, e := d.analytics.Allow(ctx, d.aliases, user.Login, user.ID)
	if e != nil {
		adminJSON(w, 503, map[string]string{"error": "authorization unavailable"})
		return
	}
	if !allowed {
		adminJSON(w, 403, map[string]string{"error": "GitHub account is not an administrator"})
		return
	}
	nonce := randomNonce()
	if nonce == "" {
		w.WriteHeader(503)
		return
	}
	avatar, err := url.Parse(user.Avatar)
	if err != nil || avatar.Scheme != "https" || avatar.Host != "avatars.githubusercontent.com" {
		user.Avatar = ""
	}
	session := adminSession{user.ID, user.Login, user.Avatar, time.Now().Add(7 * 24 * time.Hour).Unix(), nonce}
	setAdminCookie(w, sessionCookie, d.sign("session", session), 7*24*3600)
	http.Redirect(w, r, "/dashboard", 303)
}
func (d *dashboard) githubJSON(req *http.Request, out any) bool {
	req.Header.Set("User-Agent", "wasm.fyi admin OAuth")
	resp, e := d.client.Do(req)
	if e != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return false
	}
	b, e := io.ReadAll(io.LimitReader(resp.Body, 65537))
	return e == nil && len(b) <= 65536 && json.Unmarshal(b, out) == nil
}
func (d *dashboard) stream(w http.ResponseWriter, r *http.Request, s adminSession) {
	select {
	case d.streams <- struct{}{}:
		defer func() { <-d.streams }()
	default:
		w.WriteHeader(429)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		if time.Now().Unix() >= s.Expires || !d.authorized(r, s) {
			return
		}
		rc.SetWriteDeadline(time.Now().Add(5 * time.Second))
		b, _ := json.Marshal(d.analytics.Live(time.Now()))
		if _, e := fmt.Fprintf(w, "data: %s\n\n", b); e != nil {
			return
		}
		if e := rc.Flush(); e != nil {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
		}
	}
}
func (a *API) pageEvent(w http.ResponseWriter, r *http.Request) {
	d := a.dashboard
	if !d.sameOrigin(r) {
		w.WriteHeader(403)
		return
	}
	if r.Header.Get("DNT") == "1" || r.Header.Get("Sec-GPC") == "1" {
		w.WriteHeader(204)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	defer r.Body.Close()
	var body struct {
		Path     string `json:"path"`
		Referrer string `json:"referrer"`
		Screen   string `json:"screen"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(&body) != nil {
		w.WriteHeader(400)
		return
	}
	if dec.Decode(new(any)) != io.EOF {
		w.WriteHeader(400)
		return
	}
	if !analytics.ValidPagePath(body.Path) {
		w.WriteHeader(400)
		return
	}
	path := analytics.CleanPath(body.Path)
	if path == "/other" || strings.HasPrefix(path, "/dashboard") || strings.HasPrefix(path, "/auth/") || strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/admin/") {
		w.WriteHeader(400)
		return
	}
	if body.Screen != "Desktop" && body.Screen != "Mobile" && body.Screen != "Tablet" {
		w.WriteHeader(400)
		return
	}
	ip, e := a.limiter.clientIdentity(r, false)
	if e != nil {
		w.WriteHeader(400)
		return
	}
	agent, browser, _ := analytics.Family(r.UserAgent())
	now := time.Now()
	ref := "Direct / none"
	if body.Referrer != "" {
		ref = analytics.ReferrerHost("https://" + body.Referrer)
	}
	d.analytics.Enqueue(analytics.Input{IP: ip, Event: analytics.Event{At: now, ID: d.analytics.Identity(now, ip, agent), Origin: 0, Pageview: true, Path: path, Referrer: ref, Device: body.Screen, Browser: browser, Agent: agent}})
	w.WriteHeader(204)
}

func (d *dashboard) developmentAllowed(r *http.Request) bool {
	u, err := url.Parse(d.origin)
	if err != nil || !strings.EqualFold(r.Host, u.Host) {
		return false
	}
	peer := net.ParseIP(peerIdentity(r.RemoteAddr))
	if peer == nil || !peer.IsLoopback() || d.limiter == nil {
		return false
	}
	client, err := d.limiter.clientIdentity(r, false)
	if err != nil {
		return false
	}
	ip := net.ParseIP(client)
	return ip != nil && ip.IsLoopback()
}
func (d *dashboard) authorized(r *http.Request, s adminSession) bool {
	if d.development {
		return d.developmentAllowed(r)
	}
	return d.analytics.Pinned(r.Context(), d.aliases, s.ID) && !d.analytics.Revoked(r.Context(), s.Nonce)
}
