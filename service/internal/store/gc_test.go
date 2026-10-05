package store

import (
	"bytes"
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestGCRetainsPublishedAndPendingThenQuarantinesOrphans(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	date := time.Now().UTC()
	published := publishTest(t, s, "published", date)
	pending := stage(t, s, "pending", date.Add(time.Hour))
	orphan := []byte("unused object")
	id := wire.Hash(orphan)
	if e := s.Install(id, bytes.NewReader(orphan)); e != nil {
		t.Fatal(e)
	}
	unknown := filepath.Join(root, "objects", "operator-note")
	if e := os.WriteFile(unknown, []byte("preserve"), 0600); e != nil {
		t.Fatal(e)
	}
	opts := GCOptions{Grace: time.Hour, QuarantineGrace: time.Hour, Now: date.Add(2 * time.Hour)}
	preview, e := s.GC(context.Background(), opts)
	if e != nil || preview.Candidates == 0 || preview.Unknown != 1 {
		t.Fatal(preview, e)
	}
	if _, e = os.Stat(filepath.Join(root, "objects", id)); e != nil {
		t.Fatal("preview mutated content")
	}
	opts.Apply = true
	first, e := s.GC(context.Background(), opts)
	if e != nil || first.Quarantined == 0 || first.Deleted != 0 {
		t.Fatal(first, e)
	}
	if _, e = os.Stat(filepath.Join(root, "quarantine", id)); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Results(Query{Revision: published}, false); e != nil {
		t.Fatal("published data damaged", e)
	}
	missing, e := s.Missing(pending)
	if e != nil || len(missing) != 0 {
		t.Fatal("pending data lost", e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s = openTest(t, root)
	defer s.Close()
	opts.Now = date.Add(4 * time.Hour)
	second, e := s.GC(context.Background(), opts)
	if e != nil || second.Deleted == 0 || second.BytesFreed == 0 {
		t.Fatal(second, e)
	}
	if _, e = os.Stat(unknown); e != nil {
		t.Fatal("unknown file deleted")
	}
	if s.contentBytes < 0 {
		t.Fatal("negative quota after restart cleanup")
	}
	if _, e = s.Commit(pending); e != nil {
		t.Fatal("pending data cannot publish", e)
	}
}
func TestGCRescuesQuarantinedContentReferencedByNewImport(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer s.Close()
	date := time.Now().UTC()
	j, objects, e := testutil.Fixture("future", date)
	if e != nil {
		t.Fatal(e)
	}
	for id, b := range objects {
		if e = s.Install(id, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	opts := GCOptions{Apply: true, Grace: time.Hour, QuarantineGrace: time.Hour, Now: date.Add(2 * time.Hour)}
	if _, e = s.GC(context.Background(), opts); e != nil {
		t.Fatal(e)
	}
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	opts.Now = date.Add(4 * time.Hour)
	if _, e = s.GC(context.Background(), opts); e != nil {
		t.Fatal(e)
	}
	missing, e := s.Missing(id)
	if e != nil || len(missing) != 0 {
		t.Fatal("referenced quarantined content was not rescued", e)
	}
	if _, e = s.Commit(id); e != nil {
		t.Fatal(e)
	}
}
