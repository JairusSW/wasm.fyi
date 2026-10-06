package store

import (
	"context"
	"errors"
	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
	"strings"
)

const PreparedOverviewLimit = 4096

func overviewKey(scope CohortScope) string {
	return overviewVersionKey(scope, comparison.Version, comparison.CategoryVersion)
}
func overviewVersionKey(scope CohortScope, version, category string) string {
	b, _ := wire.Encode([]any{version, category, scope})
	return wire.Hash(b)
}
func (s *Store) overviewRoot() string { s.mu.RLock(); defer s.mu.RUnlock(); return s.overviews }
func (s *Store) PreparedOverview(ctx context.Context, scope CohortScope) (OverviewResponse, error) {
	var out OverviewResponse
	normalized, e := s.NormalizeCohort(scope)
	if e != nil {
		return out, e
	}
	if e = s.publish.LockContext(ctx); e != nil {
		return out, e
	}
	defer s.publish.Unlock()
	return s.preparedOverviewAt(ctx, normalized, s.overviewRoot())
}

// Caller pins the registry root while holding the publication lock.
func (s *Store) preparedOverviewAt(ctx context.Context, normalized CohortScope, root string) (OverviewResponse, error) {
	var out OverviewResponse
	if e := ctx.Err(); e != nil {
		return out, e
	}
	id, e := s.mapGet(root, overviewKey(normalized))
	if e != nil {
		return out, e
	}
	if id == "" {
		return out, ErrNotFound
	}
	if e = s.load(id, &out); e != nil {
		return out, e
	}
	b, _ := wire.Encode(normalized)
	stored, _ := wire.Encode(out.Scope)
	if string(b) != string(stored) || out.Interpretation.Version != comparison.Version || out.CategoryPolicy != comparison.CategoryVersion || out.Cohort != "" || out.Revision != normalized.Revision || !wire.IsHash(out.Digest) {
		return out, wire.Invalid("prepared overview binding differs")
	}
	return out, nil
}
func (s *Store) PrepareOverview(ctx context.Context, scope CohortScope) (OverviewResponse, error) {
	normalized, e := s.NormalizeCohort(scope)
	if e != nil {
		return OverviewResponse{}, e
	}
	if ready, e := s.PreparedOverview(ctx, normalized); e == nil {
		return ready, nil
	} else if e != ErrNotFound {
		return OverviewResponse{}, e
	}
	cohort, e := s.ComputeCohort(ctx, normalized)
	if e != nil {
		return OverviewResponse{}, e
	}
	out, e := s.BuildOverview(&cohort)
	if e != nil {
		return out, e
	}
	if e = s.publish.LockContext(ctx); e != nil {
		return out, e
	}
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return out, ErrNeedsRestart
	}
	keyID := overviewKey(normalized)
	old, e := s.mapGet(s.overviewRoot(), keyID)
	if e != nil {
		return out, e
	}
	if old != "" {
		return out, nil
	}
	if s.overviewCount >= PreparedOverviewLimit {
		return out, ErrQuota
	}
	record, e := s.put(out)
	if e != nil {
		return out, e
	}
	root, e := s.mapSet(s.overviewRoot(), keyID, record, 0)
	if e != nil {
		return out, e
	}
	if e = ctx.Err(); e != nil {
		return out, e
	}
	if e = s.checkpoint("overview-before-commit"); e != nil {
		return out, e
	}
	if e = s.db.Set(key("overviews"), []byte(root), pebble.Sync); e != nil {
		s.poisoned.Store(true)
		return out, e
	}
	if e = s.checkpoint("overview-after-commit"); e != nil {
		s.poisoned.Store(true)
		return out, e
	}
	if e = s.portableRoots(s.Current(), s.registrationRoot(), root); e != nil {
		s.poisoned.Store(true)
		return out, e
	}
	s.mu.Lock()
	s.overviews = root
	s.overviewCount++
	s.mu.Unlock()
	return out, nil
}
func (s *Store) initializeOverviews() error {
	b, e := s.get(key("overviews"))
	if errors.Is(e, pebble.ErrNotFound) {
		return nil
	}
	if e != nil {
		return e
	}
	s.overviews = string(b)
	if !wire.IsHash(s.overviews) {
		return wire.Invalid("invalid overview root")
	}
	budget := ScanLimit
	return s.walk(s.overviews, &budget, func(string, string) error {
		s.overviewCount++
		if s.overviewCount > PreparedOverviewLimit {
			return ErrLimit
		}
		return nil
	})
}
func (s *Store) markOverviews(ctx context.Context, marked map[string]bool) error {
	root := s.overviewRoot()
	if root == "" {
		return nil
	}
	if e := s.markRegistrationNodes(ctx, root, marked); e != nil {
		return e
	}
	count := 0
	presets := 0
	budget := ScanLimit
	return s.walk(root, &budget, func(keyID, id string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		count++
		if count > PreparedOverviewLimit {
			return ErrLimit
		}
		if strings.HasPrefix(keyID, presetPrefix) {
			presets++
			if presets > OverviewPresetLimit {
				return ErrLimit
			}
			var p OverviewPreset
			if e := s.load(id, &p); e != nil {
				return e
			}
			if e := s.validatePreset(keyID, p); e != nil {
				return e
			}
			marked[id] = true
			return nil
		}
		var out OverviewResponse
		if e := s.load(id, &out); e != nil {
			return e
		}
		normalized, e := s.NormalizeCohort(out.Scope)
		if e != nil {
			return e
		}
		b, _ := wire.Encode(normalized)
		actual, _ := wire.Encode(out.Scope)
		if string(b) != string(actual) || out.Revision != out.Scope.Revision || !wire.IsIdentity(out.Interpretation.Version) || !wire.IsIdentity(out.CategoryPolicy) || out.Cohort != "" || !wire.IsHash(out.Digest) || overviewVersionKey(normalized, out.Interpretation.Version, out.CategoryPolicy) != keyID {
			return wire.Invalid("recovered overview binding differs")
		}
		marked[id] = true
		return nil
	})
}
