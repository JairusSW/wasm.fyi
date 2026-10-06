package store

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

func planFixture(t *testing.T) (wire.PlanRegistration, []byte) {
	t.Helper()
	j, objects := plannedFixture(t, "before-first-job", "local", "corpus-0001", true)
	p := wire.PlanRegistration{Schema: 1, Session: j.Session, Plan: j.Plan, ConfiguredHarnessPin: j.ConfiguredHarnessPin, SessionPlan: *j.SessionPlan}
	return p, objects[p.SessionPlan.Chunks[0].SHA256]
}
func TestRegisteredPlanLifecycleAndPortableRecovery(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s, e := Open(filepath.Join(root, "live"), "fixture")
	if e != nil {
		t.Fatal(e)
	}
	defer func() { s.Close() }()
	r, raw := planFixture(t)
	id, e := s.SubmitPlan(ctx, r)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.RegisteredSession(r.Session); e != ErrNotFound {
		t.Fatal("staging visible", e)
	}
	if _, e = s.CommitPlan(ctx, id); e == nil {
		t.Fatal("missing chunks registered")
	}
	missing, e := s.MissingPlan(ctx, id)
	if e != nil || len(missing) != 1 {
		t.Fatal(missing, e)
	}
	if e = s.InstallDeclared(missing[0].SHA256, bytes.NewReader(raw)); e != nil {
		t.Fatal(e)
	}
	if _, e = s.CommitPlan(ctx, id); e != nil {
		t.Fatal(e)
	}
	out, e := s.RegisteredSession(r.Session)
	if e != nil || out.Members != 2 || out.PlannedJobs != 4 || s.Current() != "" {
		t.Fatal(out, e, s.Current())
	}
	if dup, e := s.SubmitPlan(ctx, r); e != nil || dup != id {
		t.Fatal(dup, e)
	}
	if dup, e := s.CommitPlan(ctx, id); e != nil || dup != id {
		t.Fatal(dup, e)
	}
	q, e := s.quota()
	if e != nil || q.Jobs != 0 || q.Bytes != 0 {
		t.Fatal(q, e)
	}
	if e = s.AbortPlan(ctx, id); e != ErrConflict {
		t.Fatal(e)
	}
	job, _ := plannedFixture(t, "outside-registered", "outside", "corpus-0001", false)
	if _, e = s.Submit(job); e == nil {
		t.Fatal("out-of-plan completed job admitted")
	}
	backup := filepath.Join(root, "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	if _, e = VerifyBackup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s, e = Open(filepath.Join(root, "live"), "fixture")
	if e != nil {
		t.Fatal(e)
	}
	if got, e := s.RegisteredSession(r.Session); e != nil || got != out {
		t.Fatal(got, e)
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
		got, e := copy.RegisteredSession(r.Session)
		if e != nil || got != out {
			t.Fatal(mode, got, e)
		}
		dup, e := copy.SubmitPlan(ctx, r)
		if e != nil || dup != id {
			t.Fatal(mode, dup, e)
		}
		if _, e = copy.CommitPlan(ctx, id); e != nil {
			t.Fatal(mode, e)
		}
		copy.Close()
	}
}
func TestRegisteredPlanCrashAndPendingAdmission(t *testing.T) {
	for _, stage := range []string{"plan-before-commit", "plan-after-commit"} {
		t.Run(stage, func(t *testing.T) {
			root := t.TempDir()
			s, e := Open(root, "fixture")
			if e != nil {
				t.Fatal(e)
			}
			r, raw := planFixture(t)
			id, e := s.SubmitPlan(context.Background(), r)
			if e != nil {
				t.Fatal(e)
			}
			if e = s.InstallDeclared(r.SessionPlan.Chunks[0].SHA256, bytes.NewReader(raw)); e != nil {
				t.Fatal(e)
			}
			injected := errors.New("simulated crash")
			s.fail = func(at string) error {
				if at == stage {
					return injected
				}
				return nil
			}
			if _, e = s.CommitPlan(context.Background(), id); !errors.Is(e, injected) {
				t.Fatal(e)
			}
			if _, e = s.RegisteredSession(r.Session); e != ErrNotFound {
				t.Fatal("unacknowledged registration exposed", e)
			}
			s.Close()
			s, e = Open(root, "fixture")
			if e != nil {
				t.Fatal(e)
			}
			defer s.Close()
			if stage == "plan-after-commit" {
				if _, e = s.RegisteredSession(r.Session); e != nil {
					t.Fatal(e)
				}
			} else {
				if _, e = s.RegisteredSession(r.Session); e != ErrNotFound {
					t.Fatal(e)
				}
			}
			// Force the same admission migration path used for older stores.
			if e = s.db.Delete(key("admission-ready-v3"), pebble.Sync); e != nil {
				t.Fatal(e)
			}
			if e = s.initializeAdmission(); e != nil {
				t.Fatal(e)
			}
			q, e := s.quota()
			if e != nil {
				t.Fatal(e)
			}
			want := 1
			if stage == "plan-after-commit" {
				want = 0
			}
			if q.Jobs != want {
				t.Fatal(q, want)
			}
			if _, e = s.CommitPlan(context.Background(), id); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestPlanStagingAbortCancellationAndCleanup(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	r, raw := planFixture(t)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, e := s.SubmitPlan(canceled, r); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	id, e := s.SubmitPlan(ctx, r)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.InstallDeclared(r.SessionPlan.Chunks[0].SHA256, bytes.NewReader(raw)); e != nil {
		t.Fatal(e)
	}
	marked, e := s.reachable(true)
	if e != nil || !marked[r.SessionPlan.Chunks[0].SHA256] {
		t.Fatal("active source not retained", e)
	}
	required, e := s.reachable(false)
	if e != nil || required[r.SessionPlan.Chunks[0].SHA256] {
		t.Fatal("staging became public", e)
	}
	if _, e = s.CommitPlan(canceled, id); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if e = s.AbortPlan(ctx, id); e != nil {
		t.Fatal(e)
	}
	if _, e = s.CommitPlan(ctx, id); e != ErrConflict {
		t.Fatal(e)
	}
	if _, e = s.SubmitPlan(ctx, r); e != ErrConflict {
		t.Fatal(e)
	}
	marked, e = s.reachable(true)
	if e != nil || marked[r.SessionPlan.Chunks[0].SHA256] {
		t.Fatal("aborted source retained", e)
	}
	q, e := s.quota()
	if e != nil || q.Jobs != 0 || q.Bytes != 0 {
		t.Fatal(q, e)
	}
	if e = s.InstallDeclared(r.SessionPlan.Chunks[0].SHA256, bytes.NewReader(raw)); e != ErrUndeclared {
		t.Fatal("aborted upload allowed", e)
	}
}
