package api

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func FuzzQueryAndCursor(f *testing.F) {
	for _, seed := range []string{"", "limit=1", "limit=1&limit=2", "workload=%FF", "workload=%00", "revision=abc", "scope={}", "%ZZ=x", "metric=time.wall;profile=timing", "from=2026-10-05T00:00:00Z&until=2026-10-06T00:00:00Z"} {
		f.Add(seed)
	}
	a := &API{CursorKey: bytes.Repeat([]byte{1}, 32)}
	f.Add(a.sign(cursor{Revision: strings.Repeat("a", 64), Query: "fixture", Offset: 1}))
	f.Fuzz(func(t *testing.T, raw string) {
		if len(raw) > 20*1024 {
			return
		}
		values, err := strictQuery(raw)
		if err == nil {
			normalized, err := strictQuery(values.Encode())
			if err != nil || normalized.Encode() != values.Encode() {
				t.Fatal("query normalization changed accepted scope", err)
			}
			for _, route := range []string{"results", "history", "manifest", "overview", "sessions/fixture/jobs", "methods/" + strings.Repeat("a", 64), "artifacts/" + strings.Repeat("a", 64) + "/functions"} {
				_ = routeQuery(route, values)
			}
		}
		if cur, err := a.parse(raw); err == nil {
			if cur.Offset < 0 || !wire.IsHash(cur.Revision) {
				t.Fatal("invalid cursor admitted")
			}
			roundTrip, err := a.parse(a.sign(cur))
			if err != nil || roundTrip != cur {
				t.Fatal("signed cursor did not round trip", err)
			}
		}
		_, _, _ = nativeRange(raw, 1400000)
		_ = acceptsGzip(raw)
	})
}

func TestProblemDoesNotExposeWrappedInternalDetails(t *testing.T) {
	for _, err := range []error{&os.PathError{Op: "open", Path: "/private/operator/data", Err: os.ErrPermission}, errors.New("secret token in internal database error"), errors.Join(wire.Invalid("private source path"), errors.New("secret detail"))} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/api/v1/results", nil)
		problem(w, r, err)
		for _, secret := range []string{"/private/", "secret", "operator"} {
			if strings.Contains(w.Body.String(), secret) {
				t.Fatal("error exposed internal details", w.Body.String())
			}
		}
	}
	for _, sentinel := range []error{store.ErrNotFound, store.ErrLimit, store.ErrNeedsRestart, store.ErrConflict, store.ErrQuota, store.ErrUndeclared} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/api/v1/results", nil)
		problem(w, r, errors.Join(sentinel, &os.PathError{Op: "open", Path: "/private/operator/data", Err: os.ErrPermission}))
		if strings.Contains(w.Body.String(), "/private/") {
			t.Fatal("wrapped public sentinel exposed internal path", w.Body.String())
		}
	}
	for _, code := range []struct {
		err    error
		status int
	}{{store.ErrNotFound, http.StatusNotFound}, {store.ErrLimit, 422}, {store.ErrNeedsRestart, 503}, {store.ErrConflict, 409}, {store.ErrQuota, 507}, {store.ErrUndeclared, 403}, {wire.Invalid("bad field"), 400}, {context.Canceled, 503}, {&http.MaxBytesError{Limit: 1}, 413}} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/api/v1/results", nil)
		problem(w, r, code.err)
		if w.Code != code.status {
			t.Fatal("structured error status changed", w.Code, code.status)
		}
	}
	if _, err := strictQuery(url.Values{"revision": []string{""}}.Encode()); err == nil {
		t.Fatal("empty identity accepted")
	}
}
