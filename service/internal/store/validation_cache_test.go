package store

import (
	"context"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"path/filepath"
	"testing"
)

func TestValidationCacheIsBoundedAndDoesNotShareMutableBytes(t *testing.T) {
	cache := &validationCache{}
	calls := 0
	fetch := func(ctx context.Context, id string, ceiling int) ([]byte, error) {
		calls++
		return []byte("verified"), nil
	}
	a, err := cache.read(context.Background(), "a", 100, fetch)
	if err != nil {
		t.Fatal(err)
	}
	a[0] = 'X'
	b, err := cache.read(context.Background(), "a", 100, fetch)
	if err != nil || string(b) != "verified" || calls != 1 {
		t.Fatal("cache changed bytes or repeated IO")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = cache.read(ctx, "a", 100, fetch); err != context.Canceled {
		t.Fatal("cancellation ignored")
	}
	if _, err = cache.read(context.Background(), "a", 1, fetch); err == nil {
		t.Fatal("cached bytes bypassed decoded ceiling")
	}
	large := func(context.Context, string, int) ([]byte, error) {
		return make([]byte, validationCacheEntryBytes), nil
	}
	for i := 0; i < 1100; i++ {
		if _, err = cache.read(context.Background(), fmt.Sprint(i), validationCacheEntryBytes, large); err != nil {
			t.Fatal(err)
		}
	}
	if cache.bytes > validationCacheBytes || cache.entries["a"] != nil {
		t.Fatal("cache budget or eviction failed")
	}
}
func TestValidationCacheDoesNotHideCorruptionFromNextPass(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	body := []byte("valid metadata")
	id := wire.Hash(body)
	if err := s.installBytes(id, body); err != nil {
		t.Fatal(err)
	}
	first := s.validationStore()
	if _, err := first.content(id); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.root, "objects", id), []byte("corrupt metadata"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, reader := range []*Store{s, s.validationStore()} {
		if _, err := reader.content(id); err == nil {
			t.Fatal("previous validation cache hid new corruption")
		}
	}
}
