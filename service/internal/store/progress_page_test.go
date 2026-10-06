package store

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestProgressPageGlobalSortFilterAndChanges(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	r, raw := planFixture(t)
	id, e := s.SubmitPlan(ctx, r)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.InstallDeclared(r.SessionPlan.Chunks[0].SHA256, bytes.NewReader(raw)); e != nil {
		t.Fatal(e)
	}
	if _, e = s.CommitPlan(ctx, id); e != nil {
		t.Fatal(e)
	}
	empty, e := s.ProgressPage(ctx, ProgressScope{Session: r.Session}, "", 0, 2)
	if e != nil || empty.Total != 0 || len(empty.Items) != 0 {
		t.Fatal(empty, e)
	}
	for i := 39; i >= 0; i-- {
		status := "running"
		if i%2 == 0 {
			status = "completed"
		}
		u := wire.Progress{Schema: 1, Session: r.Session, Plan: r.Plan, Machine: "local", Corpus: "corpus-0001", Attempt: fmt.Sprintf("attempt-%02d", i), Sequence: 1, Status: status, ObservedAt: time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)}
		if _, e = s.RecordProgress(ctx, u); e != nil {
			t.Fatal(e)
		}
	}
	for _, corpus := range []string{"corpus-0002", "corpus-0001"} {
		u := wire.Progress{Schema: 1, Session: r.Session, Plan: r.Plan, Machine: "hub", Corpus: corpus, Attempt: "hub-attempt", Sequence: 1, Status: "running", ObservedAt: time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)}
		if _, e = s.RecordProgress(ctx, u); e != nil {
			t.Fatal(e)
		}
	}
	all, e := s.ProgressPage(ctx, ProgressScope{Session: r.Session}, "", 0, 3)
	if e != nil || all.Total != 42 || all.Items[0].Update.Machine != "hub" || all.Items[0].Update.Corpus != "corpus-0001" || all.Items[1].Update.Corpus != "corpus-0002" || all.Items[2].Update.Machine != "local" {
		t.Fatal(all, e)
	}
	narrowed, e := s.ProgressPage(ctx, ProgressScope{Session: r.Session, Machine: "hub", Corpus: "corpus-0002"}, "", 0, 3)
	if e != nil || narrowed.Total != 1 || narrowed.Items[0].Update.Corpus != "corpus-0002" {
		t.Fatal(narrowed, e)
	}
	scope := ProgressScope{Session: r.Session, Status: "completed"}
	first, e := s.ProgressPage(ctx, scope, "", 0, 3)
	if e != nil || first.Total != 20 || first.Next != 3 {
		t.Fatal(first, e)
	}
	for i, item := range first.Items {
		if item.Update.Attempt != fmt.Sprintf("attempt-%02d", i*2) {
			t.Fatal(item)
		}
	}
	next, e := s.ProgressPage(ctx, scope, first.Root, first.Next, 3)
	if e != nil || next.Items[0].Update.Attempt != "attempt-06" {
		t.Fatal(next, e)
	}
	other, e := s.ProgressPage(ctx, ProgressScope{Session: r.Session, Machine: "unknown"}, "", 0, 3)
	if e != nil || other.Total != 0 {
		t.Fatal(other, e)
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "fixture"); e != nil {
		t.Fatal(e)
	}
	copy, e := Open(rebuilt, "fixture")
	if e != nil {
		t.Fatal(e)
	}
	restored, e := copy.ProgressPage(ctx, scope, first.Root, first.Next, 3)
	copy.Close()
	if e != nil || restored.Root != next.Root || restored.Total != next.Total || restored.Items[0].ID != next.Items[0].ID {
		t.Fatal(restored, e)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, e = s.ProgressPage(canceled, scope, "", 0, 3); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	u := first.Items[0].Update
	u.Attempt = "attempt-new"
	u.Status = "running"
	if _, e = s.RecordProgress(ctx, u); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ProgressPage(ctx, scope, first.Root, 3, 3); e != ErrProgressChanged {
		t.Fatal("changed generation continued", e)
	}
}
