package api

import (
	"bytes"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type observedBody struct{ reads int }

func (b *observedBody) Read(p []byte) (int, error) { b.reads++; return 0, io.EOF }

func TestRejectedUploadsDoNotReadRequestBodies(t *testing.T) {
	s, err := store.Open(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	token := strings.Repeat("x", 32)
	h, err := New(s, token, bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		method, path, authorization string
		status                      int
	}{
		{"POST", "/admin/v1/imports", "", 401},
		{"PUT", "/admin/v1/objects/" + wire.Hash([]byte("undeclared")), "Bearer wrong-token", 401},
		{"PUT", "/admin/v1/objects/" + wire.Hash([]byte("undeclared")), "Bearer " + token, 403},
		{"PUT", "/admin/v1/objects/" + wire.Hash([]byte("undeclared")) + "?unexpected=1", "Bearer " + token, 400},
	} {
		body := &observedBody{}
		r := httptest.NewRequest(c.method, c.path, body)
		r.Header.Set("Authorization", c.authorization)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.status || body.reads != 0 {
			t.Fatal("rejected ingress consumed body", c.path, w.Code, body.reads, w.Body.String())
		}
	}
	if s.Current() != "" {
		t.Fatal("rejected request published state")
	}
}
