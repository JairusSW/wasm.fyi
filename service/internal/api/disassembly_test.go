package api

import (
	"bytes"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestDisassemblyHTTPWindowAndCursorScope(t *testing.T) {
	job, objects, id, err := testutil.DisassemblyFixture("http-disassembly", time.Now().UTC(), "header\n0: nop\n1: ret\ntrailing")
	if err != nil {
		t.Fatal(err)
	}
	s, err := store.Open(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for hash, b := range objects {
		if err = s.Install(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	receipt, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := s.Commit(receipt)
	if err != nil {
		t.Fatal(err)
	}
	h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/artifacts/" + id + "/disassembly?revision=" + revision + "&function=0&limit=2"
	w := request(t, h, "GET", base, nil, nil)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var page struct {
		Revision   string                `json:"revision"`
		Window     store.DisassemblyPage `json:"window"`
		Complete   bool                  `json:"complete"`
		NextCursor string                `json:"nextCursor"`
		Offset     int                   `json:"offset"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Complete || page.Window.Total != 4 || page.NextCursor == "" || page.Offset != 0 || page.Window.Version != wire.DisassemblyVersion || !strings.Contains(page.Window.Interpretation, "Synthetic") {
		t.Fatal(page)
	}
	token := url.QueryEscape(page.NextCursor)
	w = request(t, h, "GET", base+"&cursor="+token, nil, nil)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || !page.Complete || page.Offset != 2 || strings.Join(page.Window.Items, "") != "1: ret\ntrailing" {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, path := range []string{strings.Replace(base, "function=0", "function=1", 1) + "&cursor=" + token, strings.Replace(base, "limit=2", "limit=3", 1) + "&cursor=" + token, strings.Replace(base, "function=0", "function=-1", 1), base + "&offset=1", strings.Replace(base, "function=0", "function=", 1), base + "&download=1"} {
		w = request(t, h, "GET", path, nil, nil)
		if w.Code != 400 {
			t.Fatal(path, w.Code, w.Body.String())
		}
	}
	w = request(t, h, "GET", strings.Replace(base, "function=0", "function=1", 1), nil, nil)
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}
