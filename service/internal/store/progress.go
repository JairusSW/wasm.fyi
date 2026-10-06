package store

import (
	"context"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

const ProgressLimit = 10000

type AttemptProgress struct {
	ID         string        `json:"id"`
	Update     wire.Progress `json:"update"`
	RecordedAt time.Time     `json:"recordedAt"`
}

func progressKey(p wire.Progress) string {
	b, _ := wire.Encode([]string{p.Machine, p.Corpus, p.Attempt})
	return string(b)
}
func (s *Store) AttemptProgress(session, machine, corpus, attempt string) (AttemptProgress, error) {
	return s.AttemptProgressContext(context.Background(), session, machine, corpus, attempt)
}
func (s *Store) AttemptProgressContext(ctx context.Context, session, machine, corpus, attempt string) (AttemptProgress, error) {
	if e := s.publish.LockContext(ctx); e != nil {
		return AttemptProgress{}, e
	}
	defer s.publish.Unlock()
	return s.attemptProgress(session, machine, corpus, attempt)
}
func (s *Store) attemptProgress(session, machine, corpus, attempt string) (AttemptProgress, error) {
	var out AttemptProgress
	if !wire.IsIdentity(machine) || !wire.IsIdentity(corpus) || !wire.IsIdentity(attempt) {
		return out, ErrNotFound
	}
	p, e := s.registered(session)
	if e != nil {
		return out, e
	}
	if p.Progress == nil {
		return out, ErrNotFound
	}
	id, e := s.mapGet(p.Progress.Root, progressKey(wire.Progress{Machine: machine, Corpus: corpus, Attempt: attempt}))
	if e != nil {
		return out, e
	}
	if id == "" {
		return out, ErrNotFound
	}
	e = s.load(id, &out)
	if e != nil {
		return out, e
	}
	if out.Update.Session != session || out.Update.Machine != machine || out.Update.Corpus != corpus || out.Update.Attempt != attempt {
		return out, wire.Invalid("attempt progress binding differs")
	}
	return out, validateProgress(out)
}
func validateProgress(p AttemptProgress) error {
	if e := p.Update.Validate(); e != nil {
		return e
	}
	b, e := wire.Encode(p.Update)
	if e != nil {
		return e
	}
	if p.ID != wire.Hash(b) || p.RecordedAt.IsZero() {
		return wire.Invalid("attempt progress identity differs")
	}
	return nil
}
func (s *Store) RecordProgress(ctx context.Context, update wire.Progress) (AttemptProgress, error) {
	var out AttemptProgress
	if e := s.publish.LockContext(ctx); e != nil {
		return out, e
	}
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return out, ErrNeedsRestart
	}
	if e := update.Validate(); e != nil {
		return out, e
	}
	p, e := s.registered(update.Session)
	if e != nil {
		return out, e
	}
	if e = s.checkRegisteredJob(wire.Job{Session: update.Session, Plan: update.Plan, ConfiguredHarnessPin: p.Registration.ConfiguredHarnessPin, Machine: update.Machine, Corpus: update.Corpus}); e != nil {
		return out, e
	}
	b, e := wire.Encode(update)
	if e != nil {
		return out, e
	}
	identity := wire.Hash(b)
	old, e := s.attemptProgress(update.Session, update.Machine, update.Corpus, update.Attempt)
	if e == nil {
		if old.ID == identity {
			return old, nil
		}
		if old.Update.Status != "running" || update.Sequence != old.Update.Sequence+1 {
			return out, ErrConflict
		}
	} else if e == ErrNotFound {
		if update.Sequence != 1 {
			return out, ErrConflict
		}
	} else {
		return out, e
	}
	if p.Progress == nil {
		p.Progress = &indexSet{}
	}
	if old.ID == "" && p.Progress.Count >= ProgressLimit {
		return out, ErrQuota
	}
	out = AttemptProgress{ID: identity, Update: update, RecordedAt: time.Now().UTC()}
	record, e := s.put(out)
	if e != nil {
		return out, e
	}
	p.Progress.Root, e = s.mapSet(p.Progress.Root, progressKey(update), record, 0)
	if e != nil {
		return out, e
	}
	if old.ID == "" {
		p.Progress.Count++
	}
	descriptor, e := s.put(p)
	if e != nil {
		return out, e
	}
	root, e := s.mapSet(s.registrationRoot(), update.Session, descriptor, 0)
	if e != nil {
		return out, e
	}
	if e = ctx.Err(); e != nil {
		return out, e
	}
	if e = s.checkpoint("progress-before-commit"); e != nil {
		return out, e
	}
	if e = s.db.Set(key("registrations"), []byte(root), pebble.Sync); e != nil {
		s.poisoned.Store(true)
		return out, e
	}
	if e = s.checkpoint("progress-after-commit"); e != nil {
		s.poisoned.Store(true)
		return out, e
	}
	if e = s.portableWithRegistrations(s.Current(), root); e != nil {
		s.poisoned.Store(true)
		return out, e
	}
	s.mu.Lock()
	s.registrations = root
	s.mu.Unlock()
	return out, nil
}
func (s *Store) markProgress(ctx context.Context, p registeredPlan, scope wire.PlanScope, marked map[string]bool) error {
	if p.Progress == nil {
		return nil
	}
	if p.Progress.Count < 1 || p.Progress.Count > ProgressLimit || !wire.IsHash(p.Progress.Root) {
		return wire.Invalid("invalid progress index")
	}
	if e := s.markRegistrationNodes(ctx, p.Progress.Root, marked); e != nil {
		return e
	}
	count := 0
	budget := ScanLimit
	if e := s.walk(p.Progress.Root, &budget, func(k, id string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		var state AttemptProgress
		if e := s.load(id, &state); e != nil {
			return e
		}
		if e := validateProgress(state); e != nil {
			return e
		}
		u := state.Update
		if k != progressKey(u) || u.Session != p.Registration.Session || u.Plan != scope.Plan || !scope.Contains(u.Machine, u.Corpus) {
			return wire.Invalid("recovered attempt outside registered scope")
		}
		count++
		marked[id] = true
		return nil
	}); e != nil {
		return e
	}
	if count != p.Progress.Count {
		return wire.Invalid("progress count differs")
	}
	return nil
}
