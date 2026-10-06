package store

import (
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHistoryCoverageRebuildRejectsUnpublishedOrigin(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer s.Close()
	job, err := testutil.HistoryCoverageFixture("declared", "darwin/arm64")
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	current, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	staged := job
	staged.Attempt = "unpublished-source"
	stagedID, err := s.Submit(staged)
	if err != nil {
		t.Fatal(err)
	}
	if actual, err := s.put(staged); err != nil || actual != stagedID {
		t.Fatal(err)
	}
	revision, err := s.Revision(current)
	if err != nil {
		t.Fatal(err)
	}
	revision.Indexes, err = s.indexAdd(revision.Indexes, indexKey("history-coverage-origins", "", ""), wire.Hash(job.HistoryCoverage[0]), stagedID)
	if err != nil {
		t.Fatal(err)
	}
	altered, err := s.put(revision)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(t.TempDir(), "portable")
	if err = os.MkdirAll(snapshot, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.CopyFS(filepath.Join(snapshot, "objects"), os.DirFS(filepath.Join(root, "objects"))); err != nil {
		t.Fatal(err)
	}
	pointer, _ := wire.Encode(portablePointer{Schema: 1, Current: altered})
	if err = atomicFile(filepath.Join(snapshot, "published.json"), pointer, 0600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "rebuilt")
	err = Rebuild(snapshot, destination, "test")
	if err == nil || !strings.Contains(err.Error(), "coverage source") {
		t.Fatal("unpublished coverage source was accepted", err)
	}
	if _, err = os.Stat(destination); !os.IsNotExist(err) {
		t.Fatal("invalid recovery installed a destination", err)
	}
}
