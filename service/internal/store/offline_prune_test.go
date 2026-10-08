package store

import (
	"bytes"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"testing"
)

func TestOfflinePrunesOnlyUnpublishedUnreferencedMapPages(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	s.EnableOfflineImport()
	permanent, err := s.put(node{Entries: map[string]string{"permanent": wire.Hash([]byte("old"))}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.flushOffline(); err != nil {
		t.Fatal(err)
	}
	unused, err := s.put(node{Entries: map[string]string{"unused": wire.Hash([]byte("unused"))}})
	if err != nil {
		t.Fatal(err)
	}
	child, err := s.put(node{Entries: map[string]string{"kept": wire.Hash([]byte("child"))}})
	if err != nil {
		t.Fatal(err)
	}
	// Follow references through non-node metadata, nested arrays and hash map keys.
	bridge, err := s.put(map[string]any{"nested": []any{map[string]any{child: true}}})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.put(node{Entries: map[string]string{"bridge": bridge}})
	if err != nil {
		t.Fatal(err)
	}
	// Evidence that happens to have a node shape must never be pruned.
	input := node{Entries: map[string]string{"producer-input": wire.Hash([]byte("input"))}}
	body, _ := wire.Encode(input)
	inputID := wire.Hash(body)
	if err = s.Install(inputID, bytes.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.put(input); err != nil {
		t.Fatal(err)
	}
	if err = s.flushOffline(root); err != nil {
		t.Fatal(err)
	}
	if _, err = s.content(unused); !os.IsNotExist(err) {
		t.Fatalf("unused private page installed: %v", err)
	}
	for _, id := range []string{permanent, child, bridge, root, inputID} {
		if _, err = s.content(id); err != nil {
			t.Fatalf("referenced, permanent or source object lost: %s %v", id, err)
		}
	}
	if s.OfflineDiscardedIndexPages() != 1 {
		t.Fatal("wrong pruning boundary")
	}
}
