package artifactdb

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"
)

func TestRetentionAndRenewal(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	ctx := context.Background()
	b := []byte{0, 97, 115, 109, 1, 0, 0, 0}
	sum := sha256.Sum256(b)
	hash := hex.EncodeToString(sum[:])
	if _, err = s.Put(ctx, hash, bytes.NewReader(b)); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"applications/a", "applications/b"} {
		body, _ := json.Marshal(map[string]string{"id": id, "sha256": hash})
		if err = s.Register(ctx, hash, body); err != nil {
			t.Fatal(err)
		}
	}
	page, err := s.List(ctx, Query{Limit: 1, Prefix: "applications/"})
	if err != nil || len(page.Artifacts) != 1 || page.Next == "" {
		t.Fatal(page, err)
	}
	next, err := s.List(ctx, Query{Limit: 1, After: page.Next})
	if err != nil || len(next.Artifacts) != 1 || next.Next != "" {
		t.Fatal(next, err)
	}
	now = now.Add(89 * 24 * time.Hour)
	if _, err = s.Put(ctx, hash, bytes.NewReader(b)); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * 24 * time.Hour)
	if err = s.Prune(ctx); err != nil {
		t.Fatal(err)
	}
	f, _, _, err := s.Download(ctx, hash)
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	now = now.Add(Retention)
	if _, _, _, err = s.Download(ctx, hash); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("expiry before prune", err)
	}
	page, err = s.List(ctx, Query{})
	if err != nil || len(page.Artifacts) != 0 {
		t.Fatal(page, err)
	}
	if err = s.Prune(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRow("SELECT count(*) FROM contracts").Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
	if _, err = s.root.Stat(hash + ".wasm"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("binary retained", err)
	}
}
func TestRejectInvalidUpload(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	b := []byte{0, 97, 115, 109, 1, 0, 0, 0}
	sum := sha256.Sum256(b)
	hash := hex.EncodeToString(sum[:])
	ctx := context.Background()
	for _, data := range [][]byte{nil, append(b, 1)} {
		if _, err = s.Put(ctx, hash, bytes.NewReader(data)); err == nil {
			t.Fatal("accepted invalid bytes")
		}
	}
	if _, err = s.Put(ctx, "../index.sqlite", bytes.NewReader(b)); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	files, _ := os.ReadDir(s.root.Name())
	for _, f := range files {
		if len(f.Name()) >= 8 && f.Name()[:8] == ".upload-" {
			t.Fatal("temporary upload leaked")
		}
	}
}

func TestCataloguePaginatesByByteBudget(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	b := []byte{0, 97, 115, 109, 1, 0, 0, 0}
	sum := sha256.Sum256(b)
	hash := hex.EncodeToString(sum[:])
	if _, err = s.Put(ctx, hash, bytes.NewReader(b)); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b"} {
		body, _ := json.Marshal(map[string]string{"id": id, "sha256": hash, "description": string(bytes.Repeat([]byte{'x'}, 600000))})
		if err = s.Register(ctx, hash, body); err != nil {
			t.Fatal(err)
		}
	}
	page, err := s.List(ctx, Query{Limit: 100})
	if err != nil || len(page.Artifacts) != 1 || page.Next == "" {
		t.Fatal(len(page.Artifacts), page.Next, err)
	}
	page, err = s.List(ctx, Query{Limit: 100, After: page.Next})
	if err != nil || len(page.Artifacts) != 1 || page.Next != "" {
		t.Fatal(len(page.Artifacts), page.Next, err)
	}
}
