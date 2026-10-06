package store

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestAttemptProgressOrderingAndPortable(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s := openTest(t, filepath.Join(root, "live"))
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
	u := wire.Progress{Schema: 1, Session: r.Session, Plan: r.Plan, Machine: "local", Corpus: "corpus-0001", Attempt: "attempt-1", Sequence: 1, Status: "running", Phase: "timing", ObservedAt: time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)}
	first, e := s.RecordProgress(ctx, u)
	if e != nil {
		t.Fatal(e)
	}
	dup, e := s.RecordProgress(ctx, u)
	if e != nil || dup != first {
		t.Fatal("retry changed receipt", dup, e)
	}
	bad := u
	bad.Sequence = 3
	if _, e = s.RecordProgress(ctx, bad); e != ErrConflict {
		t.Fatal("gap admitted", e)
	}
	bad = u
	bad.Status = "failed"
	if _, e = s.RecordProgress(ctx, bad); e != ErrConflict {
		t.Fatal("same sequence replacement admitted", e)
	}
	bad = u
	bad.Machine = "other"
	if _, e = s.RecordProgress(ctx, bad); e == nil {
		t.Fatal("outside scope admitted")
	}
	u.Sequence = 2
	u.Status = "interrupted"
	terminal, e := s.RecordProgress(ctx, u)
	if e != nil {
		t.Fatal(e)
	}
	u.Sequence = 3
	u.Status = "running"
	if _, e = s.RecordProgress(ctx, u); e != ErrConflict {
		t.Fatal("terminal regression admitted", e)
	}
	u.Sequence = 1
	u.Attempt = "attempt-2"
	if _, e = s.RecordProgress(ctx, u); e != nil {
		t.Fatal(e)
	}
	if s.Current() != "" {
		t.Fatal("progress created measurement revision")
	}
	backup := filepath.Join(root, "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	for _, mode := range []string{"restore", "rebuild"} {
		dest := filepath.Join(root, mode)
		if mode == "restore" {
			e = Restore(ctx, backup, dest, "fixture")
		} else {
			e = Rebuild(backup, dest, "fixture")
		}
		if e != nil {
			t.Fatal(mode, e)
		}
		copy, e := Open(dest, "fixture")
		if e != nil {
			t.Fatal(e)
		}
		got, e := copy.AttemptProgress(r.Session, "local", "corpus-0001", "attempt-1")
		if e != nil || got != terminal {
			t.Fatal(mode, got, e)
		}
		copy.Close()
	}
}

func TestProgressPublicationFaultVisibility(t *testing.T) {
	for _, stage := range []string{"progress-before-commit", "progress-after-commit"} {
		t.Run(stage, func(t *testing.T) {
			ctx := context.Background()
			root := t.TempDir()
			s := openTest(t, root)
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
			u := wire.Progress{Schema: 1, Session: r.Session, Plan: r.Plan, Machine: "local", Corpus: "corpus-0001", Attempt: "fault-attempt", Sequence: 1, Status: "running", ObservedAt: time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)}
			injected := errors.New("fault")
			s.fail = func(at string) error {
				if at == stage {
					return injected
				}
				return nil
			}
			if _, e = s.RecordProgress(ctx, u); !errors.Is(e, injected) {
				t.Fatal(e)
			}
			if _, e = s.AttemptProgress(r.Session, u.Machine, u.Corpus, u.Attempt); e != ErrNotFound {
				t.Fatal("unacknowledged state visible", e)
			}
			s.Close()
			s, e = Open(root, "fixture")
			if e != nil {
				t.Fatal(e)
			}
			defer s.Close()
			if _, e = s.RecordProgress(ctx, u); e != nil {
				t.Fatal(e)
			}
			got, e := s.AttemptProgress(r.Session, u.Machine, u.Corpus, u.Attempt)
			if e != nil || got.Update != u {
				t.Fatal(got, e)
			}
		})
	}
}

func TestProgressReadUpdateAndCleanup(t *testing.T) {
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
	u := wire.Progress{Schema: 1, Session: r.Session, Plan: r.Plan, Machine: "local", Corpus: "corpus-0001", Attempt: "live", Sequence: 1, Status: "running", ObservedAt: time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)}
	if _, e = s.RecordProgress(ctx, u); e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 3)
	go func() {
		for seq := 2; seq <= 20; seq++ {
			update := u
			update.Sequence = seq
			if _, e := s.RecordProgress(ctx, update); e != nil {
				done <- e
				return
			}
		}
		done <- nil
	}()
	go func() {
		for i := 0; i < 40; i++ {
			got, e := s.AttemptProgressContext(ctx, r.Session, u.Machine, u.Corpus, u.Attempt)
			if e != nil {
				done <- e
				return
			}
			if got.Update.Sequence < 1 || got.Update.Sequence > 20 {
				done <- errors.New("invalid visible sequence")
				return
			}
		}
		done <- nil
	}()
	go func() {
		for i := 0; i < 3; i++ {
			if _, e := s.GC(ctx, GCOptions{Apply: true, Grace: time.Hour, QuarantineGrace: time.Hour, Now: time.Now().Add(48 * time.Hour)}); e != nil {
				done <- e
				return
			}
		}
		done <- nil
	}()
	for i := 0; i < 3; i++ {
		if e := <-done; e != nil {
			t.Fatal(e)
		}
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, e := s.AttemptProgressContext(canceled, r.Session, u.Machine, u.Corpus, u.Attempt); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if _, e := s.RegisteredSessionContext(canceled, r.Session); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}
