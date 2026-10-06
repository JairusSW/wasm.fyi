package api

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func TestMethodSelectorRequiresExactDigestAndDoesNotInferLegacy(t *testing.T) {
	s, e := store.Open(t.TempDir(), "test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	importFixture(t, s, "legacy", time.Now().UTC())
	h, e := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if e != nil {
		t.Fatal(e)
	}
	for _, route := range []string{"/api/v1/results", "/api/v1/history"} {
		w := request(t, h, "GET", route+"?method="+strings.Repeat("a", 64), nil, nil)
		var page struct {
			Total int
			Items []json.RawMessage
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 0 || len(page.Items) != 0 {
			t.Fatal("legacy results silently assigned a method", w.Code, w.Body.String())
		}
		for _, query := range []string{"method=", "method=abc", "method=" + strings.Repeat("A", 64), "method=" + strings.Repeat("a", 64) + "&method=" + strings.Repeat("b", 64)} {
			if w := request(t, h, "GET", route+"?"+query, nil, nil); w.Code != 400 {
				t.Fatal("malformed method selector accepted", query, w.Code)
			}
		}
	}
}
