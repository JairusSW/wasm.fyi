package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Deterministically deliver cancellation inside validation without a scheduling
// race or a sleep. Done/Err still come from an ordinary cancellable context.
type cancelDuringValidation struct {
	context.Context
	cancel       context.CancelFunc
	calls        atomic.Int32
	once         sync.Once
	at           int32
	beforeCancel func()
}

func (c *cancelDuringValidation) Err() error {
	if c.calls.Add(1) >= c.at {
		c.once.Do(func() {
			if c.beforeCancel != nil {
				c.beforeCancel()
			}
			c.cancel()
		})
	}
	return c.Context.Err()
}
func validationCancellation(t *testing.T, before func()) *cancelDuringValidation {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return &cancelDuringValidation{Context: ctx, cancel: cancel, at: 16, beforeCancel: before}
}
func TestMaintenanceCancellationInterruptsIntegrityBeforeMutation(t *testing.T) {
	for _, operation := range []string{"closure", "backup", "cleanup"} {
		t.Run(operation, func(t *testing.T) {
			root := t.TempDir()
			s := openTest(t, root)
			defer s.Close()
			job, objects := plannedFixture(t, "cancel-validation", "local", "corpus-0001", true)
			current, e := s.Commit(stagePlannedFixture(t, s, job, objects))
			if e != nil {
				t.Fatal(e)
			}
			parent := t.TempDir()
			destination := filepath.Join(parent, "backup")
			ctx := validationCancellation(t, func() {
				entries, e := os.ReadDir(parent)
				if e != nil || len(entries) != 0 {
					t.Fatal("backup began copying before cancellation", entries, e)
				}
				if _, e := os.Stat(filepath.Join(root, "quarantine")); !os.IsNotExist(e) {
					t.Fatal("cleanup began mutating before cancellation", e)
				}
			})
			switch operation {
			case "closure":
				_, e = s.reachableContext(ctx, false)
			case "backup":
				_, e = s.Backup(ctx, destination)
			case "cleanup":
				_, e = s.GC(ctx, GCOptions{Apply: true, Grace: time.Hour, QuarantineGrace: time.Hour})
			}
			if !errors.Is(e, context.Canceled) || ctx.calls.Load() < ctx.at {
				t.Fatal("integrity scan ignored cancellation", e, ctx.calls.Load())
			}
			if s.Current() != current {
				t.Fatal("cancellation changed publication")
			}
			// Cancellation must release maintenance ownership, permitting a new write.
			next := job
			next.SessionPlan = nil
			next.Attempt = "after-cancel"
			next.Corpus = "corpus-0002"
			if id, e := s.Submit(next); e != nil {
				t.Fatal("maintenance lock not released", e)
			} else if _, e := s.Commit(id); e != nil {
				t.Fatal(e)
			}
		})
	}
}
