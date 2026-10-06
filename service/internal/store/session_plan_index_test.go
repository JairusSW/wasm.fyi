package store

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestIndexedPlanProgressDoesNotReadLargeSourcePlan(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer func() { s.Close() }()
	j, objects := plannedFixture(t, "large-indexed-plan", "local", "corpus-0001", false)
	jobs := []any{}
	for i := 1; i <= 1000; i++ {
		jobs = append(jobs, map[string]any{"id": fmt.Sprintf("corpus-%04d", i)})
	}
	raw, e := wire.Encode(map[string]any{"schema": 1, "configuredHarnessPin": j.ConfiguredHarnessPin, "machines": []any{map[string]any{"name": "local"}, map[string]any{"name": "hub"}}, "jobs": jobs, "retainedSourceOptions": strings.Repeat("x", 2*wire.ReportFileChunkBytes)})
	if e != nil {
		t.Fatal(e)
	}
	j.Plan = wire.Hash(raw)
	j.SessionPlan = &wire.SessionPlan{Schema: 1, Bytes: len(raw)}
	for start := 0; start < len(raw); start += wire.ReportFileChunkBytes {
		b := raw[start:min(len(raw), start+wire.ReportFileChunkBytes)]
		o := wire.Object{Kind: "binary", SHA256: wire.Hash(b), Bytes: len(b)}
		j.SessionPlan.Chunks = append(j.SessionPlan.Chunks, o)
		objects[o.SHA256] = b
	}
	id := stagePlannedFixture(t, s, j, objects)
	revision, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	check := func(s *Store) {
		t.Helper()
		info, e := s.SessionInfo(context.Background(), revision, j.Session)
		if e != nil || info.PlannedJobs == nil || *info.PlannedJobs != 2000 || info.PublishedCorpusJobs != 1 {
			t.Fatal(info, e)
		}
	}
	check(s)
	// These removals are a read-dependency probe, not an assertion that missing
	// source evidence is acceptable for startup, backup or recovery.
	sourcePath := filepath.Join(root, "objects", id)
	source, e := os.ReadFile(sourcePath)
	if e != nil {
		t.Fatal(e)
	}
	chunk := j.SessionPlan.Chunks[0]
	chunkPath := filepath.Join(root, "objects", chunk.SHA256)
	if e := os.Remove(sourcePath); e != nil {
		t.Fatal(e)
	}
	if e := os.Remove(chunkPath); e != nil {
		t.Fatal(e)
	}
	check(s)
	if _, e := s.Backup(context.Background(), filepath.Join(t.TempDir(), "missing-evidence-backup")); e == nil {
		t.Fatal("backup accepted missing source evidence")
	}
	if e := s.installBytes(id, source); e != nil {
		t.Fatal(e)
	}
	if e := s.InstallBinary(chunk.SHA256, bytes.NewReader(objects[chunk.SHA256])); e != nil {
		t.Fatal(e)
	}
	if e := s.Close(); e != nil {
		t.Fatal(e)
	}
	s = openTest(t, root)
	check(s)
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e := s.Backup(context.Background(), backup); e != nil {
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
func TestPlanScopeLegacyReadAndProjectionMigration(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	ctx := context.Background()
	j, objects := plannedFixture(t, "legacy-plan-index", "local", "corpus-0001", true)
	revision, e := s.Commit(stagePlannedFixture(t, s, j, objects))
	if e != nil {
		t.Fatal(e)
	}
	rev, e := s.Revision(revision)
	if e != nil {
		t.Fatal(e)
	}
	directory := map[string]string{}
	budget := ScanLimit
	if e := s.walk(rev.Indexes, &budget, func(k, v string) error {
		if k != indexKey("session-plan-scope", "", "") {
			directory[k] = v
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	rev.Indexes, e = s.mapSetMany(ctx, "", directory, 0)
	if e != nil {
		t.Fatal(e)
	}
	scope, e := s.sessionPlanScope(ctx, rev, j.Session)
	if e != nil || scope.indexed != nil || scope.MemberCount != 2 || scope.CorpusCount != 2 {
		t.Fatal(scope, e)
	}
	if e := s.persistPlanScope(ctx, &rev, j.Session, scope); e != nil {
		t.Fatal(e)
	}
	indexed, e := s.sessionPlanScope(ctx, rev, j.Session)
	if e != nil || indexed.indexed == nil || indexed.SourceJob != scope.SourceJob {
		t.Fatal(indexed, e)
	}
}
func TestPortablePlanScopeRejectsAlteredMembership(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	ctx := context.Background()
	j, objects := plannedFixture(t, "corrupt-membership", "local", "corpus-0001", true)
	revision, e := s.Commit(stagePlannedFixture(t, s, j, objects))
	if e != nil {
		t.Fatal(e)
	}
	rev, e := s.Revision(revision)
	if e != nil {
		t.Fatal(e)
	}
	scope, e := s.sessionPlanScope(ctx, rev, j.Session)
	if e != nil {
		t.Fatal(e)
	}
	projection := *scope.indexed
	projection.Corpora.Root, e = s.mapSet(projection.Corpora.Root, "corpus-0002", "0", 0)
	if e != nil {
		t.Fatal(e)
	}
	metadata, e := s.put(projection)
	if e != nil {
		t.Fatal(e)
	}
	rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("session-plan-scope", "", ""), j.Session, metadata)
	if e != nil {
		t.Fatal(e)
	}
	child := j
	child.Attempt = "membership-drift-child"
	childID, e := s.put(child)
	if e != nil {
		t.Fatal(e)
	}
	rev.Job, rev.Parent, rev.Created = childID, revision, rev.Created.Add(time.Hour)
	summary := jobSummary(child, childID, rev.Created)
	summaryID, e := s.put(summary)
	if e != nil {
		t.Fatal(e)
	}
	rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("published-job", "", ""), childID, summaryID)
	if e != nil {
		t.Fatal(e)
	}
	rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("session-jobs", j.Session, ""), publishedJobKey(summary), summaryID)
	if e != nil {
		t.Fatal(e)
	}
	invalid, e := s.put(rev)
	if e != nil {
		t.Fatal(e)
	}
	s.mu.Lock()
	s.published[invalid] = rev
	s.current = invalid
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.published, invalid); s.current = revision; s.mu.Unlock() }()
	if _, e := s.reachable(false); e == nil || !strings.Contains(e.Error(), "session plan membership differs") {
		t.Fatal("derived membership drift survived portable verification", e)
	}
}
