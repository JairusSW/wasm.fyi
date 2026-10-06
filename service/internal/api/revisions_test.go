package api

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRevisionPagesFreezeChainAcrossPublishRestartAndRebuild(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "live")
	s, err := store.Open(root, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	revisions := []string{}
	for _, seed := range []string{"one", "two", "three"} {
		revisions = append(revisions, importFixture(t, s, seed, time.Now().UTC()))
	}
	key, err := s.CursorKey()
	if err != nil {
		t.Fatal(err)
	}
	handler, err := New(s, strings.Repeat("x", 32), key)
	if err != nil {
		t.Fatal(err)
	}
	type revisionPage struct {
		Revision   string
		Items      []string
		Total      int
		NextCursor string
		Complete   bool
	}
	first := request(t, handler, "GET", "/api/v1/revisions?limit=1", nil, nil)
	var page revisionPage
	if first.Code != 200 || json.Unmarshal(first.Body.Bytes(), &page) != nil || page.Total != 3 || len(page.Items) != 1 || page.Items[0] != revisions[2] || page.NextCursor == "" {
		t.Fatal("first page", first.Code, first.Body.String())
	}
	initialCursor := page.NextCursor
	importFixture(t, s, "new-publication", time.Now().UTC())
	check := func(s *store.Store) {
		t.Helper()
		handler, err := New(s, strings.Repeat("x", 32), key)
		if err != nil {
			t.Fatal(err)
		}
		next := initialCursor
		seen := []string{}
		for next != "" {
			w := request(t, handler, "GET", "/api/v1/revisions?limit=1&cursor="+url.QueryEscape(next), nil, nil)
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 3 || page.Revision != revisions[2] || len(page.Items) != 1 {
				t.Fatal("frozen revision page", w.Code, w.Body.String())
			}
			seen = append(seen, page.Items...)
			next = page.NextCursor
		}
		if len(seen) != 2 || seen[0] != revisions[1] || seen[1] != revisions[0] || !page.Complete {
			t.Fatal("revision order changed", seen)
		}
		for _, path := range []string{"/api/v1/revisions?limit=2&cursor=" + url.QueryEscape(initialCursor), "/api/v1/revisions?limit=1&revision=" + s.Current() + "&cursor=" + url.QueryEscape(initialCursor)} {
			if request(t, handler, "GET", path, nil, nil).Code != 400 {
				t.Fatal("cursor scope mismatch accepted", path)
			}
		}
		// Legacy offset-only tokens are never silently reinterpreted.
		signer := &API{CursorKey: bytes.Clone(key)}
		old := signer.sign(cursor{Revision: revisions[2], Query: "revisions:1", Offset: 1})
		if request(t, handler, "GET", "/api/v1/revisions?limit=1&cursor="+url.QueryEscape(old), nil, nil).Code != 400 {
			t.Fatal("legacy cursor accepted")
		}
	}
	check(s)
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s = nil
	s, err = store.Open(root, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	check(s)
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	rebuilt := filepath.Join(dir, "rebuilt")
	if err = store.Rebuild(backup, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.Open(rebuilt, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	check(recovered)
}
