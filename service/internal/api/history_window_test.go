package api

import (
	"bytes"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func TestHistoryWindowCursorAndParameterContract(t *testing.T) {
	s, e := store.Open(t.TempDir(), "test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	h, e := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if e != nil {
		t.Fatal(e)
	}
	jan := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	feb := jan.AddDate(0, 1, 0)
	march := feb.AddDate(0, 1, 0)
	importFixture(t, s, "jan", jan)
	rev := importFixture(t, s, "feb", feb)
	query := "from=" + url.QueryEscape(feb.Format(time.RFC3339Nano)) + "&until=" + url.QueryEscape(march.Format(time.RFC3339Nano)) + "&limit=1"
	w := request(t, h, "GET", "/api/v1/history?"+query, nil, nil)
	var page struct {
		Revision, NextCursor string
		Total                int
		Items                []json.RawMessage
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 3 || len(page.Items) != 1 || page.NextCursor == "" {
		t.Fatal("history window page invalid", w.Code, w.Body.String())
	}
	cursor := page.NextCursor
	importFixture(t, s, "march", march)
	equivalent := "from=" + url.QueryEscape("2026-02-01T01:00:00+01:00") + "&until=" + url.QueryEscape(march.Format(time.RFC3339Nano)) + "&limit=1&cursor=" + url.QueryEscape(cursor)
	w = request(t, h, "GET", "/api/v1/history?"+equivalent, nil, nil)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Revision != rev {
		t.Fatal("equivalent window/cursor changed revision", w.Code, w.Body.String())
	}
	changed := "from=" + url.QueryEscape(jan.Format(time.RFC3339Nano)) + "&until=" + url.QueryEscape(march.Format(time.RFC3339Nano)) + "&limit=1&cursor=" + url.QueryEscape(cursor)
	if w = request(t, h, "GET", "/api/v1/history?"+changed, nil, nil); w.Code != 400 {
		t.Fatal("history window cursor mutation accepted")
	}
	for _, path := range []string{"/api/v1/history?from=&until=", "/api/v1/history?from=2026-01-01", "/api/v1/results?" + query} {
		if w = request(t, h, "GET", path, nil, nil); w.Code != 400 {
			t.Fatal("invalid window accepted", path, w.Code)
		}
	}
}
