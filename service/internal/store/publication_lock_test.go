package store

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCanceledMaintenanceLeavesPublicationQueue(t *testing.T) {
	for _, operation := range []string{"backup", "cleanup", "commit", "inventory"} {
		t.Run(operation, func(t *testing.T) {
			s := openTest(t, t.TempDir())
			defer s.Close()
			s.publish.Lock()
			defer s.publish.Unlock()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			started := make(chan struct{})
			done := make(chan error, 1)
			go func() {
				release, e := s.Lease()
				if e != nil {
					done <- e
					return
				}
				defer release()
				close(started)
				switch operation {
				case "backup":
					_, e = s.Backup(ctx, filepath.Join(t.TempDir(), "backup"))
				case "cleanup":
					_, e = s.GC(ctx, GCOptions{Apply: true, Grace: time.Hour, QuarantineGrace: time.Hour})
				case "commit":
					_, e = s.CommitContext(ctx, "unread-job")
				case "inventory":
					e = s.AttachInventoryContext(ctx, "unread-job", "unread-inventory")
				}
				done <- e
			}()
			<-started
			cancel()
			select {
			case e := <-done:
				if !errors.Is(e, context.Canceled) {
					t.Fatal(e)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("canceled maintenance retained lease while publisher held lock")
			}
			// Canceled waiters must leave the original owner's lock held.
			waiter, stop := context.WithTimeout(context.Background(), 20*time.Millisecond)
			defer stop()
			if e := s.publish.LockContext(waiter); !errors.Is(e, context.DeadlineExceeded) {
				t.Fatal("cancellation released another publisher's ownership", e)
			}
		})
	}
}
func TestPublicationLockSerializesNormalAndCancelableWriters(t *testing.T) {
	var lock publicationLock
	var active atomic.Int32
	var failures atomic.Int32
	var completed atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 64; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			if i%2 == 0 {
				lock.Lock()
			} else if e := lock.LockContext(context.Background()); e != nil {
				failures.Add(1)
				return
			}
			if active.Add(1) != 1 {
				failures.Add(1)
			}
			completed.Add(1)
			if active.Add(-1) != 0 {
				failures.Add(1)
			}
			lock.Unlock()
		}(i)
	}
	group.Wait()
	if failures.Load() != 0 || completed.Load() != 64 {
		t.Fatal("publication serialization changed", failures.Load(), completed.Load())
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if e := lock.LockContext(canceled); !errors.Is(e, context.Canceled) {
		t.Fatal("already canceled request acquired lock", e)
	}
	lock.Lock()
	lock.Unlock()
}
