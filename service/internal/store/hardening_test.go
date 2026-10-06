package store

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestContentRefusesSymlinksOversizeAndReplacement(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	body := []byte("secret")
	id := wire.Hash(body)
	outside := filepath.Join(t.TempDir(), "private")
	if e := os.WriteFile(outside, body, 0600); e != nil {
		t.Fatal(e)
	}
	link := filepath.Join(s.root, "objects", id)
	if e := os.Symlink(outside, link); e != nil {
		t.Fatal(e)
	}
	if _, e := s.content(id); e == nil {
		t.Fatal("followed content symlink")
	}
	if e := s.Install(id, bytes.NewReader(body)); e == nil {
		t.Fatal("replaced content symlink")
	}
	read, _ := os.ReadFile(outside)
	if !bytes.Equal(read, body) {
		t.Fatal("changed outside file")
	}
	if e := os.Remove(link); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(link, []byte{}, 0600); e != nil {
		t.Fatal(e)
	}
	if e := os.Truncate(link, wire.ChunkBytes+1); e != nil {
		t.Fatal(e)
	}
	if _, e := s.content(id); e == nil {
		t.Fatal("read oversized content")
	}
	if e := s.Install(id, bytes.NewReader(body)); e == nil {
		t.Fatal("overwrote corrupt existing file")
	}
}
func TestImmutableSessionAttemptAndMemberBindings(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	j, _, e := testutil.Fixture("same", time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	first, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	duplicate, e := s.Submit(j)
	if e != nil || duplicate != first {
		t.Fatal("identical redelivery changed identity")
	}
	cases := []wire.Job{j, j, j}
	cases[0].Plan = wire.Hash([]byte("different plan"))
	cases[1].ParentBundleSHA256 = wire.Hash([]byte("different parent"))
	cases[2].Exports = append([]wire.Export(nil), j.Exports...)
	cases[2].Exports[0].Manifest.Exporter = "different-exporter"
	b, _ := wire.Encode(cases[2].Exports[0].Manifest)
	cases[2].Exports[0].SHA256 = wire.Hash(b)
	for _, conflicting := range cases {
		if _, e = s.Submit(conflicting); !errors.Is(e, ErrConflict) {
			t.Fatalf("conflicting immutable identity admitted: %v", e)
		}
	}
}
func TestCanceledQueriesAndImports(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	id := stage(t, s, "first", time.Now().UTC())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := s.CommitContext(ctx, id); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if s.Current() != "" {
		t.Fatal("canceled import published")
	}
	rev, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.ResultsContext(ctx, Query{Revision: rev}, false); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if _, e = s.CatalogPage(ctx, rev, "report", 0, 100); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}
func TestScopedIndexesSkipUnrelatedCorruption(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := publishTest(t, s, "first", time.Now().UTC())
	r, e := s.Revision(rev)
	if e != nil {
		t.Fatal(e)
	}
	all, e := s.Results(Query{Revision: rev}, false)
	if e != nil {
		t.Fatal(e)
	}
	for _, record := range all {
		var value wire.Result
		if e = wire.Decode(record.Data, &value); e != nil {
			t.Fatal(e)
		}
		if value.Metric == "time.wall" {
			digest, e := s.mapGet(r.Catalog, "result:"+record.ID)
			if e != nil {
				t.Fatal(e)
			}
			if e = os.WriteFile(filepath.Join(s.root, "objects", digest), []byte("corrupt"), 0600); e != nil {
				t.Fatal(e)
			}
		}
	}
	selected, e := s.Results(Query{Revision: rev, Metric: "process.peak_rss"}, false)
	if e != nil || len(selected) != 1 {
		t.Fatalf("narrow query touched unrelated evidence: %d %v", len(selected), e)
	}
	reports, e := s.CatalogPage(context.Background(), rev, "report", 0, 100)
	if e != nil || len(reports.Items) != 1 {
		t.Fatalf("report page touched unrelated results: %v", e)
	}
}

func TestContentDiskFailureDoesNotPublishAndRetryRestoresDurability(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	body := []byte("disk-failure-fixture")
	id := wire.Hash(body)
	for _, point := range []string{"content-synced", "content-installed"} {
		s.fail = func(stage string) error {
			if stage == point {
				return syscall.ENOSPC
			}
			return nil
		}
		e := s.Install(id, bytes.NewReader(body))
		if !errors.Is(e, syscall.ENOSPC) {
			t.Fatal("disk failure injection was not reached", point, e)
		}
		if s.Current() != "" {
			t.Fatal("filesystem failure published dataset")
		}
		s.fail = nil
		if e = s.Install(id, bytes.NewReader(body)); e != nil {
			t.Fatal("durability retry failed", e)
		}
		if _, e = s.content(id); e != nil {
			t.Fatal(e)
		}
		id = wire.Hash(append(body, byte(1)))
		body = append(body, byte(1))
	}
}
