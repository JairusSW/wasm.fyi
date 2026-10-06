package store

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func plannedFixture(t *testing.T, seed, machine, corpus string, attach bool) (wire.Job, map[string][]byte) {
	t.Helper()
	j, objects, e := testutil.Fixture(seed, time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC))
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := wire.Encode(map[string]any{"schema": 1, "configuredHarnessPin": j.ConfiguredHarnessPin, "machines": []any{map[string]any{"name": "local"}, map[string]any{"name": "hub"}}, "jobs": []any{map[string]any{"id": "corpus-0001"}, map[string]any{"id": "corpus-0002"}}})
	j.Plan, j.Machine, j.Corpus = wire.Hash(raw), machine, corpus
	if attach {
		o := wire.Object{SHA256: wire.Hash(raw), Bytes: len(raw), Kind: "binary"}
		j.SessionPlan = &wire.SessionPlan{Schema: 1, Bytes: len(raw), Chunks: []wire.Object{o}}
		objects[o.SHA256] = raw
	}
	return j, objects
}
func stagePlannedFixture(t *testing.T, s *Store, j wire.Job, objects map[string][]byte) string {
	t.Helper()
	for id, b := range objects {
		if e := s.Install(id, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	return id
}
func TestRegisteredSessionPlanFrozenCoverageAndPortable(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer func() { s.Close() }()
	ctx := context.Background()
	revisions := []string{}
	// The first delivery is legacy. The second attaches original plan content.
	// A later retry without plan content must still use the registered scope.
	for i, pair := range [][2]string{{"local", "corpus-0001"}, {"local", "corpus-0001"}, {"local", "corpus-0002"}, {"hub", "corpus-0001"}, {"hub", "corpus-0002"}} {
		j, objects := plannedFixture(t, fmt.Sprintf("plan-%d", i), pair[0], pair[1], i == 1)
		id := stagePlannedFixture(t, s, j, objects)
		rev, e := s.Commit(id)
		if e != nil {
			t.Fatal(e)
		}
		revisions = append(revisions, rev)
	}
	check := func(s *Store) {
		t.Helper()
		for i, rev := range revisions {
			info, e := s.SessionInfo(ctx, rev, "synthetic-session")
			if e != nil {
				t.Fatal(e)
			}
			if i == 0 {
				if info.PlannedJobs != nil || info.CollectionComplete != nil {
					t.Fatal("legacy scope changed")
				}
				continue
			}
			if info.PlannedJobs == nil || *info.PlannedJobs != 4 || info.CollectionComplete == nil || *info.CollectionComplete != (i == 4) || info.PublishedJobs != i+1 || info.PublishedCorpusJobs != i {
				t.Fatalf("wrong scoped progress: %+v", info)
			}
		}
	}
	check(s)
	for i, pair := range [][2]string{{"local", "corpus-unknown"}, {"unknown", "corpus-0001"}} {
		j, objects := plannedFixture(t, fmt.Sprintf("outside-%d", i), pair[0], pair[1], false)
		id := stagePlannedFixture(t, s, j, objects)
		if _, e := s.Commit(id); e == nil {
			t.Fatal("out-of-plan legacy delivery published")
		}
		if s.Current() != revisions[4] {
			t.Fatal("rejected job changed public revision")
		}
		if e := s.Abort(id); e != nil {
			t.Fatal(e)
		}
	}
	if e := s.Close(); e != nil {
		t.Fatal(e)
	}
	s = openTest(t, root)
	check(s)
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e := s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e := Rebuild(backup, rebuilt, "test"); e != nil {
		t.Fatal(e)
	}
	r := openTest(t, rebuilt)
	defer r.Close()
	check(r)
}
func TestSessionPlanMissingAdmissionAndRejectsLegacyOutsideScope(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	legacy, objects := plannedFixture(t, "legacy-outside", "local", "corpus-other", false)
	first, e := s.Commit(stagePlannedFixture(t, s, legacy, objects))
	if e != nil {
		t.Fatal(e)
	}
	j, objects := plannedFixture(t, "attach", "local", "corpus-0001", true)
	chunk := j.SessionPlan.Chunks[0]
	raw := objects[chunk.SHA256]
	delete(objects, chunk.SHA256)
	id := stagePlannedFixture(t, s, j, objects)
	missing, e := s.Missing(id)
	if e != nil || len(missing) != 1 || missing[0] != chunk {
		t.Fatal(missing, e)
	}
	if _, e := s.Commit(id); e == nil {
		t.Fatal("missing plan published")
	}
	if e := s.Install(chunk.SHA256, bytes.NewReader(raw)); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Commit(id); e == nil {
		t.Fatal("out-of-scope legacy progress retroactively attested")
	}
	if s.Current() != first {
		t.Fatal("invalid plan changed revision")
	}
}

func TestSessionPlanReferenceRequiresRevisionPublishedSource(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	job, objects := plannedFixture(t, "published-plan", "local", "corpus-0001", true)
	revision, err := s.Commit(stagePlannedFixture(t, s, job, objects))
	if err != nil {
		t.Fatal(err)
	}
	rev, err := s.Revision(revision)
	if err != nil {
		t.Fatal(err)
	}
	pending, objects := plannedFixture(t, "pending-plan", "local", "corpus-0002", true)
	id := stagePlannedFixture(t, s, pending, objects)
	// A content-complete canonical job still cannot establish a frozen scope
	// until that exact job appears in the revision's published-job index.
	if _, err = s.put(pending); err != nil {
		t.Fatal(err)
	}
	rev.Indexes, err = s.indexAdd(rev.Indexes, indexKey("session-plan", "", ""), job.Session, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.sessionPlanScope(context.Background(), rev, job.Session); err == nil {
		t.Fatal("staged source established published scope")
	}
}
