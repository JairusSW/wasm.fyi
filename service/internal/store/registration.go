package store

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

const RegistrationLimit = 4096

type registeredPlan struct {
	Schema       int                   `json:"schema"`
	Registration wire.PlanRegistration `json:"registration"`
	Members      indexSet              `json:"members"`
	Corpora      indexSet              `json:"corpora"`
	Progress     *indexSet             `json:"progress,omitempty"`
}
type RegisteredSession struct {
	ID                   string `json:"id"`
	RegistrationID       string `json:"registrationId"`
	Plan                 string `json:"plan"`
	ConfiguredHarnessPin string `json:"configuredHarnessPin"`
	Members              int    `json:"members"`
	PlannedJobs          int    `json:"plannedJobs"`
	Status               string `json:"status"`
}

func registrationID(r wire.PlanRegistration) string { b, _ := wire.Encode(r); return wire.Hash(b) }
func (s *Store) registrationRoot() string           { s.mu.RLock(); defer s.mu.RUnlock(); return s.registrations }
func (s *Store) registered(session string) (registeredPlan, error) {
	var p registeredPlan
	if !wire.IsIdentity(session) {
		return p, ErrNotFound
	}
	id, e := s.mapGet(s.registrationRoot(), session)
	if e != nil {
		return p, e
	}
	if id == "" {
		return p, ErrNotFound
	}
	if e = s.load(id, &p); e != nil {
		return p, e
	}
	if p.Schema != 1 || p.Registration.Session != session || p.Registration.Validate() != nil || p.Members.Count < 1 || p.Members.Count > 128 || p.Corpora.Count < 1 || p.Corpora.Count > 10000 || p.Members.Count*p.Corpora.Count > ScanLimit || !wire.IsHash(p.Members.Root) || !wire.IsHash(p.Corpora.Root) {
		return p, wire.Invalid("invalid registered plan index")
	}
	return p, nil
}
func (s *Store) RegisteredSession(session string) (RegisteredSession, error) {
	return s.RegisteredSessionContext(context.Background(), session)
}
func (s *Store) RegisteredSessionContext(ctx context.Context, session string) (RegisteredSession, error) {
	if e := s.publish.LockContext(ctx); e != nil {
		return RegisteredSession{}, e
	}
	defer s.publish.Unlock()
	p, e := s.registered(session)
	if e != nil {
		return RegisteredSession{}, e
	}
	r := p.Registration
	return RegisteredSession{session, registrationID(r), r.Plan, r.ConfiguredHarnessPin, p.Members.Count, p.Members.Count * p.Corpora.Count, "registered"}, nil
}

// Only verified scopes enter this registry. Staging uses the same bounded
// admission accounting as imports without creating any canonical Job.
func (s *Store) SubmitPlan(ctx context.Context, r wire.PlanRegistration) (string, error) {
	if e := s.publish.LockContext(ctx); e != nil {
		return "", e
	}
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return "", ErrNeedsRestart
	}
	if e := r.Validate(); e != nil {
		return "", e
	}
	b, e := wire.Encode(r)
	if e != nil {
		return "", e
	}
	id := wire.Hash(b)
	if p, e := s.registered(r.Session); e == nil {
		if registrationID(p.Registration) != id {
			return "", ErrConflict
		}
		return id, nil
	} else if e != ErrNotFound {
		return "", e
	}
	if _, e = s.get(key("plan-aborted", id)); e == nil {
		return "", ErrConflict
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return "", e
	}
	if old, e := s.get(key("plan-import", id)); e == nil {
		if !bytes.Equal(old, b) {
			return "", ErrConflict
		}
		return id, nil
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return "", e
	}
	binding := mustEncode([]string{r.Plan, r.ConfiguredHarnessPin})
	if old, e := s.get(key("session", r.Session)); e == nil {
		if !bytes.Equal(old, binding) {
			return "", ErrConflict
		}
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return "", e
	}
	batch := s.db.NewIndexedBatch()
	defer batch.Close()
	if e = s.reserveImport(batch, id, wire.Job{SessionPlan: &r.SessionPlan}); e != nil {
		return "", e
	}
	if e = batch.Set(key("session", r.Session), binding, nil); e != nil {
		return "", e
	}
	if e = batch.Set(key("plan-import", id), b, nil); e != nil {
		return "", e
	}
	if e = ctx.Err(); e != nil {
		return "", e
	}
	if e = batch.Commit(pebble.Sync); e != nil {
		s.poisoned.Store(true)
		return "", e
	}
	return id, nil
}
func (s *Store) pendingPlan(id string) (wire.PlanRegistration, error) {
	var r wire.PlanRegistration
	if !wire.IsHash(id) {
		return r, ErrNotFound
	}
	b, e := s.get(key("plan-import", id))
	if errors.Is(e, pebble.ErrNotFound) {
		return r, ErrNotFound
	}
	if e != nil {
		return r, e
	}
	if wire.Hash(b) != id {
		return r, wire.Invalid("plan import identity differs")
	}
	e = wire.Decode(b, &r)
	if e == nil {
		e = r.Validate()
	}
	return r, e
}
func (s *Store) MissingPlan(ctx context.Context, id string) ([]wire.Object, error) {
	r, e := s.pendingPlan(id)
	if e != nil {
		return nil, e
	}
	out := []wire.Object{}
	seen := map[string]bool{}
	if _, e = s.get(key("plan-aborted", id)); e == nil {
		return nil, ErrConflict
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return nil, e
	}
	for _, o := range r.SessionPlan.Chunks {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		if seen[o.SHA256] {
			continue
		}
		seen[o.SHA256] = true
		if _, e = s.objectRepresentation(o); os.IsNotExist(e) {
			out = append(out, o)
		} else if e != nil {
			return nil, e
		}
	}
	return out, ctx.Err()
}
func (s *Store) AbortPlan(ctx context.Context, id string) error {
	if e := s.publish.LockContext(ctx); e != nil {
		return e
	}
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return ErrNeedsRestart
	}
	r, e := s.pendingPlan(id)
	if e != nil {
		return e
	}
	if _, e = s.registered(r.Session); e == nil {
		return ErrConflict
	} else if e != ErrNotFound {
		return e
	}
	batch := s.db.NewBatch()
	defer batch.Close()
	if e = s.releaseImport(batch, id, wire.Job{}); e != nil {
		return e
	}
	if e = batch.Set(key("plan-aborted", id), []byte{1}, nil); e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	if e = batch.Commit(pebble.Sync); e != nil {
		s.poisoned.Store(true)
	}
	return e
}
func (s *Store) CommitPlan(ctx context.Context, id string) (string, error) {
	if e := s.publish.LockContext(ctx); e != nil {
		return "", e
	}
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return "", ErrNeedsRestart
	}
	r, e := s.pendingPlan(id)
	if e != nil {
		return "", e
	}
	if p, e := s.registered(r.Session); e == nil {
		if registrationID(p.Registration) != id {
			return "", ErrConflict
		}
		return id, nil
	} else if e != ErrNotFound {
		return "", e
	}
	if _, e = s.get(key("plan-aborted", id)); e == nil {
		return "", ErrConflict
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return "", e
	}
	s.mu.RLock()
	count := s.registrationCount
	s.mu.RUnlock()
	if count >= RegistrationLimit {
		return "", ErrQuota
	}
	missing, e := s.MissingPlan(ctx, id)
	if e != nil {
		return "", e
	}
	if len(missing) > 0 {
		return "", wire.Invalid("registration missing locked-plan chunks")
	}
	scope, e := r.Verify(ctx, s.objectRepresentation)
	if e != nil {
		return "", e
	}
	// A preexisting measurement publication must be inside this scope too.
	if current := s.Current(); current != "" {
		_, refs, e := s.sessionReferences(ctx, current, r.Session)
		if e != nil && e != ErrNotFound {
			return "", e
		}
		for _, summaryID := range refs {
			if e := ctx.Err(); e != nil {
				return "", e
			}
			var j PublishedJob
			if e = s.load(summaryID, &j); e != nil {
				return "", e
			}
			if j.Plan != r.Plan || j.ConfiguredHarnessPin != r.ConfiguredHarnessPin || !scope.Contains(j.Machine, j.Corpus) {
				return "", ErrConflict
			}
		}
	}
	p := registeredPlan{Schema: 1, Registration: r}
	build := func(names []string) (indexSet, error) {
		values := map[string]string{}
		for _, name := range names {
			values[name] = "1"
		}
		root, e := s.mapSetMany(ctx, "", values, 0)
		return indexSet{Root: root, Count: len(names)}, e
	}
	if p.Members, e = build(scope.Members); e != nil {
		return "", e
	}
	if p.Corpora, e = build(scope.Corpora); e != nil {
		return "", e
	}
	record, e := s.put(p)
	if e != nil {
		return "", e
	}
	root, e := s.mapSet(s.registrationRoot(), r.Session, record, 0)
	if e != nil {
		return "", e
	}
	if e = ctx.Err(); e != nil {
		return "", e
	}
	if e = s.checkpoint("plan-before-commit"); e != nil {
		return "", e
	}
	batch := s.db.NewBatch()
	defer batch.Close()
	if e = s.releaseImport(batch, id, wire.Job{}); e != nil {
		return "", e
	}
	if e = batch.Set(key("registrations"), []byte(root), nil); e != nil {
		return "", e
	}
	if e = batch.Commit(pebble.Sync); e != nil {
		s.poisoned.Store(true)
		return "", e
	}
	if e = s.checkpoint("plan-after-commit"); e != nil {
		s.poisoned.Store(true)
		return "", e
	}
	if e = s.portableWithRegistrations(s.Current(), root); e != nil {
		s.poisoned.Store(true)
		return "", e
	}
	s.mu.Lock()
	s.registrations = root
	s.registrationCount++
	s.mu.Unlock()
	return id, nil
}
func (s *Store) checkRegisteredJob(j wire.Job) error {
	p, e := s.registered(j.Session)
	if e == ErrNotFound {
		return nil
	}
	if e != nil {
		return e
	}
	if p.Registration.Plan != j.Plan || p.Registration.ConfiguredHarnessPin != j.ConfiguredHarnessPin {
		return ErrConflict
	}
	m, e := s.mapGet(p.Members.Root, j.Machine)
	if e != nil {
		return e
	}
	c, e := s.mapGet(p.Corpora.Root, j.Corpus)
	if e != nil {
		return e
	}
	if m != "1" || c != "1" {
		return wire.Invalid("job outside registered session plan")
	}
	return nil
}

func (s *Store) initializePlanAdmission() error {
	prefix := key("plan-import")
	it, e := s.db.NewIter(nil)
	if e != nil {
		return e
	}
	defer it.Close()
	for it.SeekGE(prefix); it.Valid() && bytes.HasPrefix(it.Key(), prefix); it.Next() {
		var r wire.PlanRegistration
		if e = wire.Decode(it.Value(), &r); e != nil {
			return e
		}
		if e = r.Validate(); e != nil {
			return e
		}
		id := registrationID(r)
		if !bytes.Equal(it.Key(), key("plan-import", id)) {
			return wire.Invalid("invalid staged plan key")
		}
		if _, e = s.get(key("plan-aborted", id)); e == nil {
			continue
		} else if !errors.Is(e, pebble.ErrNotFound) {
			return e
		}
		if p, e := s.registered(r.Session); e == nil {
			if registrationID(p.Registration) != id {
				return ErrConflict
			}
			continue
		} else if e != ErrNotFound {
			return e
		}
		batch := s.db.NewIndexedBatch()
		e = s.reserveImport(batch, id, wire.Job{SessionPlan: &r.SessionPlan})
		if e == nil {
			e = batch.Commit(pebble.Sync)
		}
		batch.Close()
		if e != nil {
			return e
		}
	}
	return it.Error()
}

// Verify exact source scope and its persistent membership projection. Staged
// chunks are retained for missing-only resume, but never enter the public map.
func (s *Store) markRegistrations(ctx context.Context, marked map[string]bool, staging bool) error {
	root := s.registrationRoot()
	budget := ScanLimit
	count := 0
	if root != "" {
		if e := s.markRegistrationNodes(ctx, root, marked); e != nil {
			return e
		}
		if e := s.walk(root, &budget, func(session, id string) error {
			count++
			if count > RegistrationLimit {
				return ErrLimit
			}
			if e := ctx.Err(); e != nil {
				return e
			}
			var p registeredPlan
			if e := s.load(id, &p); e != nil {
				return e
			}
			marked[id] = true
			if p.Schema != 1 || p.Registration.Session != session {
				return wire.Invalid("registration binding differs")
			}
			scope, e := p.Registration.Verify(ctx, func(o wire.Object) ([]byte, error) {
				b, e := s.objectRepresentation(o)
				if e == nil {
					marked[o.SHA256] = true
				}
				return b, e
			})
			if e != nil {
				return e
			}
			for _, pair := range []struct {
				set   indexSet
				names []string
			}{{p.Members, scope.Members}, {p.Corpora, scope.Corpora}} {
				if pair.set.Count != len(pair.names) {
					return wire.Invalid("registration membership count differs")
				}
				if e = s.markRegistrationNodes(ctx, pair.set.Root, marked); e != nil {
					return e
				}
				expected := map[string]bool{}
				for _, n := range pair.names {
					expected[n] = true
				}
				local := ScanLimit
				if e = s.walk(pair.set.Root, &local, func(k, v string) error {
					if !expected[k] || v != "1" {
						return wire.Invalid("registration membership differs")
					}
					delete(expected, k)
					return ctx.Err()
				}); e != nil {
					return e
				}
				if len(expected) != 0 {
					return wire.Invalid("registration members missing")
				}
			}
			return s.markProgress(ctx, p, scope, marked)
		}); e != nil {
			return e
		}
	}
	if staging {
		prefix := key("plan-import")
		it, e := s.db.NewIter(nil)
		if e != nil {
			return e
		}
		defer it.Close()
		for it.SeekGE(prefix); it.Valid() && bytes.HasPrefix(it.Key(), prefix); it.Next() {
			if e = ctx.Err(); e != nil {
				return e
			}
			var r wire.PlanRegistration
			if e = wire.Decode(it.Value(), &r); e != nil {
				return e
			}
			if e = r.Validate(); e != nil {
				return e
			}
			id := registrationID(r)
			if _, e = s.get(key("plan-aborted", id)); e == nil {
				continue
			} else if !errors.Is(e, pebble.ErrNotFound) {
				return e
			}
			for _, o := range r.SessionPlan.Chunks {
				marked[o.SHA256] = true
				if _, e = s.objectRepresentation(o); e != nil && !os.IsNotExist(e) {
					return e
				}
			}
		}
		return it.Error()
	}
	return nil
}
func (s *Store) restoreRegistrations(reader *Store, root string) error {
	budget := ScanLimit
	count := 0
	batch := s.db.NewBatch()
	defer batch.Close()
	if e := reader.walk(root, &budget, func(session, id string) error {
		count++
		if count > RegistrationLimit {
			return ErrLimit
		}
		var p registeredPlan
		if e := reader.load(id, &p); e != nil {
			return e
		}
		r := p.Registration
		b, e := wire.Encode(r)
		if e != nil {
			return e
		}
		if e = batch.Set(key("plan-import", wire.Hash(b)), b, nil); e != nil {
			return e
		}
		return batch.Set(key("session", session), mustEncode([]string{r.Plan, r.ConfiguredHarnessPin}), nil)
	}); e != nil {
		return e
	}
	if e := batch.Set(key("registrations"), []byte(root), nil); e != nil {
		return e
	}
	if e := batch.Commit(pebble.Sync); e != nil {
		return e
	}
	s.mu.Lock()
	s.registrations = root
	s.registrationCount = count
	s.mu.Unlock()
	return nil
}

func (s *Store) markRegistrationNodes(ctx context.Context, root string, marked map[string]bool) error {
	remaining := 2 * ScanLimit
	var visit func(string, string) error
	visit = func(id, path string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if !wire.IsHash(id) || len(path) > 64 || remaining == 0 {
			return ErrLimit
		}
		remaining--
		var n node
		if e := s.load(id, &n); e != nil {
			return e
		}
		if e := validateNode(n); e != nil {
			return e
		}
		marked[id] = true
		for k := range n.Entries {
			if !strings.HasPrefix(wire.Hash([]byte(k)), path) {
				return wire.Invalid("registration map routing differs")
			}
		}
		for prefix, child := range n.Children {
			if e := visit(child, path+prefix); e != nil {
				return e
			}
		}
		return nil
	}
	return visit(root, "")
}
