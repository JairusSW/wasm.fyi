package store

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"strconv"
	"testing"
)

func TestRevisionPageDoesNotWalkOlderChain(t *testing.T) {
	s := &Store{published: map[string]Revision{}}
	parent := ""
	for i := 1; i <= ScanLimit+5; i++ {
		id := wire.Hash([]byte(strconv.Itoa(i)))
		s.published[id] = Revision{Parent: parent, ordinal: i}
		parent = id
	}
	anchor := parent
	page, err := s.RevisionPageContext(context.Background(), anchor, "", 0, 2)
	if err != nil || page.Total != ScanLimit+5 || len(page.Items) != 2 || page.Offset != 2 {
		t.Fatal("bounded first page failed", page, err)
	}
	// An old missing ancestor is outside the requested page and must not be read.
	older := s.published[page.Next].Parent
	delete(s.published, older)
	next, err := s.RevisionPageContext(context.Background(), anchor, page.Next, page.Offset, 1)
	if err != nil || len(next.Items) != 1 {
		t.Fatal("unreturned ancestor was preloaded", err)
	}
	if _, err = s.RevisionPageContext(context.Background(), anchor, page.Next, 0, 1); err == nil {
		t.Fatal("successor/offset mismatch accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = s.RevisionPageContext(ctx, anchor, "", 0, 1); !errors.Is(err, context.Canceled) {
		t.Fatal("canceled page ignored", err)
	}
	b, _ := json.Marshal(s.published[anchor])
	var restored Revision
	if err = json.Unmarshal(b, &restored); err != nil || restored.ordinal != 0 {
		t.Fatal("derived chain position leaked into canonical bytes", err)
	}
}
