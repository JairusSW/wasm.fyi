package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestRebuildRejectsJobPostingWithoutPublishedRevision(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer s.Close()
	job, objects := plannedFixture(t, "publication-posting", "local", "corpus-0001", true)
	if _, e := s.Commit(stagePlannedFixture(t, s, job, objects)); e != nil {
		t.Fatal(e)
	}
	for _, chunk := range job.SessionPlan.Chunks {
		delete(objects, chunk.SHA256)
	}
	second := job
	second.SessionPlan = nil
	second.Corpus = "corpus-0002"
	second.Attempt = "second"
	current, e := s.Commit(stagePlannedFixture(t, s, second, objects))
	if e != nil {
		t.Fatal(e)
	}
	staged := second
	staged.Corpus = "corpus-0001"
	staged.Attempt = "staged-only"
	stagedID := stagePlannedFixture(t, s, staged, objects)
	if id, e := s.put(staged); e != nil || id != stagedID {
		t.Fatal(id, e)
	}
	rev, e := s.Revision(current)
	if e != nil {
		t.Fatal(e)
	}
	summary := jobSummary(staged, stagedID, rev.Created)
	summaryID, e := s.put(summary)
	if e != nil {
		t.Fatal(e)
	}
	rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("published-job", "", ""), stagedID, summaryID)
	if e != nil {
		t.Fatal(e)
	}
	rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("session-jobs", staged.Session, ""), publishedJobKey(summary), summaryID)
	if e != nil {
		t.Fatal(e)
	}
	invalid, e := s.put(rev)
	if e != nil {
		t.Fatal(e)
	}
	snapshot := filepath.Join(t.TempDir(), "portable")
	if e := os.MkdirAll(snapshot, 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.CopyFS(filepath.Join(snapshot, "objects"), os.DirFS(filepath.Join(root, "objects"))); e != nil {
		t.Fatal(e)
	}
	pointer, _ := wire.Encode(portablePointer{Schema: 1, Current: invalid})
	if e := atomicFile(filepath.Join(snapshot, "published.json"), pointer, 0600); e != nil {
		t.Fatal(e)
	}
	destination := filepath.Join(t.TempDir(), "rebuilt")
	if e := Rebuild(snapshot, destination, "test"); e == nil {
		t.Fatal("staged job became public through hash-consistent postings")
	}
	if _, e := os.Stat(destination); !os.IsNotExist(e) {
		t.Fatal("rejected recovery installed destination", e)
	}
}

func TestRebuildRejectsFutureJobInFrozenPostingTree(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer s.Close()
	job, objects := plannedFixture(t, "future-posting", "local", "corpus-0001", true)
	first, e := s.Commit(stagePlannedFixture(t, s, job, objects))
	if e != nil {
		t.Fatal(e)
	}
	for _, chunk := range job.SessionPlan.Chunks {
		delete(objects, chunk.SHA256)
	}
	second := job
	second.SessionPlan = nil
	second.Corpus = "corpus-0002"
	second.Attempt = "second"
	latest, e := s.Commit(stagePlannedFixture(t, s, second, objects))
	if e != nil {
		t.Fatal(e)
	}
	before, e := s.Revision(first)
	if e != nil {
		t.Fatal(e)
	}
	after, e := s.Revision(latest)
	if e != nil {
		t.Fatal(e)
	}
	// Both revisions reuse the complete latest posting tree. A cached validation
	// of that tree in the newer view must not bless future jobs in the older view.
	before.Indexes = after.Indexes
	invalidParent, e := s.put(before)
	if e != nil {
		t.Fatal(e)
	}
	after.Parent = invalidParent
	invalid, e := s.put(after)
	if e != nil {
		t.Fatal(e)
	}
	assertInvalidPublicationSnapshot(t, s, root, invalid, "newer than frozen revision")
}
func TestRebuildRejectsInventedJobPublicationTimestamp(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer s.Close()
	job, objects := plannedFixture(t, "false-timestamp", "local", "corpus-0001", true)
	revision, e := s.Commit(stagePlannedFixture(t, s, job, objects))
	if e != nil {
		t.Fatal(e)
	}
	rev, e := s.Revision(revision)
	if e != nil {
		t.Fatal(e)
	}
	summary := jobSummary(job, rev.Job, rev.Created.Add(time.Hour))
	id, e := s.put(summary)
	if e != nil {
		t.Fatal(e)
	}
	rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("published-job", "", ""), rev.Job, id)
	if e != nil {
		t.Fatal(e)
	}
	invalid, e := s.put(rev)
	if e != nil {
		t.Fatal(e)
	}
	assertInvalidPublicationSnapshot(t, s, root, invalid, "matching publication origin")
}
func assertInvalidPublicationSnapshot(t *testing.T, s *Store, root, id, reason string) {
	t.Helper()
	snapshot := filepath.Join(t.TempDir(), "portable")
	if e := os.MkdirAll(snapshot, 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.CopyFS(filepath.Join(snapshot, "objects"), os.DirFS(filepath.Join(root, "objects"))); e != nil {
		t.Fatal(e)
	}
	pointer, _ := wire.Encode(portablePointer{Schema: 1, Current: id})
	if e := atomicFile(filepath.Join(snapshot, "published.json"), pointer, 0600); e != nil {
		t.Fatal(e)
	}
	destination := filepath.Join(t.TempDir(), "rebuilt")
	e := Rebuild(snapshot, destination, "test")
	if e == nil || !strings.Contains(e.Error(), reason) {
		t.Fatal("wrong recovery rejection", e)
	}
	if _, e := os.Stat(destination); !os.IsNotExist(e) {
		t.Fatal("rejected recovery installed destination", e)
	}
}
