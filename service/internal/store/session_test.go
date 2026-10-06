package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
)

func TestPublishedSessionProgressFrozenAndPortable(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	ctx := context.Background()
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	first := publishTest(t, s, "first", date)
	second := publishTest(t, s, "second", date.Add(time.Hour))
	job, _, e := testutil.Fixture("pending", date.Add(2*time.Hour))
	if e != nil {
		t.Fatal(e)
	}
	pending, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	check := func(s *Store) {
		t.Helper()
		info, e := s.SessionInfo(ctx, second, job.Session)
		if e != nil || info.PublishedJobs != 2 || info.Members != 1 || info.PlannedJobs != nil || info.CollectionComplete != nil || info.Plan != job.Plan {
			t.Fatal("invented progress or lost binding", info, e)
		}
		page, e := s.SessionJobs(ctx, second, job.Session, 0, 1)
		if e != nil || page.Total != 2 || len(page.Items) != 1 || page.Next != 1 || len(page.Items[0].Reports) != 1 {
			t.Fatal("unbounded session page", e)
		}
		for _, item := range page.Items {
			if item.ID == pending || item.PublicationStatus != "published" || item.CollectionStatus != "completed" {
				t.Fatal("staging disclosed")
			}
		}
		old, e := s.SessionInfo(ctx, first, job.Session)
		if e != nil || old.PublishedJobs != 1 {
			t.Fatal("frozen progress changed", e)
		}
	}
	check(s)
	if e = s.Abort(pending); e != nil {
		t.Fatal(e)
	}
	check(s)
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "test"); e != nil {
		t.Fatal(e)
	}
	r := openTest(t, rebuilt)
	defer r.Close()
	check(r)
	if _, e = s.SessionInfo(ctx, second, "unknown-session"); e != ErrNotFound {
		t.Fatal("unknown session accepted", e)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, e = s.SessionJobs(canceled, second, job.Session, 0, 1); e != context.Canceled {
		t.Fatal("cancellation ignored", e)
	}
}
