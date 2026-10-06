package store

import (
	"context"
	"sync"
)

// A zero-value publication lock preserves ordinary serialization while letting
// context-bearing operations leave the queue without a waiting goroutine.
type publicationLock struct {
	once sync.Once
	held chan struct{}
}

func (m *publicationLock) initialize() { m.once.Do(func() { m.held = make(chan struct{}, 1) }) }
func (m *publicationLock) Lock()       { _ = m.LockContext(context.Background()) }
func (m *publicationLock) LockContext(ctx context.Context) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	m.initialize()
	select {
	case m.held <- struct{}{}:
		// If readiness and cancellation raced, do not transfer canceled ownership.
		if e := ctx.Err(); e != nil {
			m.Unlock()
			return e
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (m *publicationLock) Unlock() {
	m.initialize()
	select {
	case <-m.held:
	default:
		panic("unlock of unlocked publication lock")
	}
}
