package store

import (
	"context"
	"sort"
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

const OverviewPresetLimit = 8
const presetPrefix = "preset:"

type OverviewPreset struct {
	Name         string      `json:"name"`
	Version      string      `json:"version"`
	SeedRevision string      `json:"seedRevision"`
	Scope        CohortScope `json:"scope"`
}

func (s *Store) overviewPresets(ctx context.Context, root string) ([]OverviewPreset, error) {
	presets := []OverviewPreset{}
	budget := ScanLimit
	e := s.walk(root, &budget, func(keyID, id string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if !strings.HasPrefix(keyID, presetPrefix) {
			return nil
		}
		if len(presets) >= OverviewPresetLimit {
			return ErrLimit
		}
		var p OverviewPreset
		if e := s.load(id, &p); e != nil {
			return e
		}
		if e := s.validatePreset(keyID, p); e != nil {
			return e
		}
		presets = append(presets, p)
		return nil
	})
	return presets, e
}
func (s *Store) validatePreset(keyID string, p OverviewPreset) error {
	if !wire.IsIdentity(p.Name) || !wire.IsIdentity(p.Version) || keyID != presetPrefix+p.Name || !wire.IsHash(p.SeedRevision) || p.Scope.Revision != "" {
		return wire.Invalid("invalid overview preset")
	}
	scope := p.Scope
	scope.Revision = p.SeedRevision
	normalized, e := s.NormalizeCohort(scope)
	if e != nil {
		return e
	}
	normalized.Revision = ""
	expected, _ := wire.Encode(normalized)
	actual, _ := wire.Encode(p.Scope)
	if string(expected) != string(actual) {
		return wire.Invalid("overview preset scope differs")
	}
	return nil
}

// Preset registration publishes its seed projection and configuration together.
// Cohort computation runs outside the publication lock over a pinned revision;
// admission is checked again after acquiring the lock for the final commit.
func (s *Store) RegisterOverviewPreset(ctx context.Context, name string, scope CohortScope) (OverviewPreset, error) {
	var preset OverviewPreset
	if !wire.IsIdentity(name) {
		return preset, wire.Invalid("invalid preset name")
	}
	normalized, e := s.NormalizeCohort(scope)
	if e != nil {
		return preset, e
	}
	preset = OverviewPreset{Name: name, Version: comparison.Version, SeedRevision: normalized.Revision, Scope: normalized}
	preset.Scope.Revision = ""
	if e = s.publish.LockContext(ctx); e != nil {
		return preset, e
	}
	var view OverviewResponse
	var preparedErr error
	func() {
		defer s.publish.Unlock()
		if s.poisoned.Load() {
			e = ErrNeedsRestart
			return
		}
		if _, e = s.presetAdmission(ctx, s.overviewRoot(), name); e != nil {
			return
		}
		view, preparedErr = s.preparedOverviewAt(ctx, normalized, s.overviewRoot())
	}()
	if e != nil {
		return preset, e
	}
	if preparedErr != nil {
		if preparedErr != ErrNotFound {
			return preset, preparedErr
		}
		cohort, err := s.ComputeCohort(ctx, normalized)
		if err != nil {
			return preset, err
		}
		view, e = s.BuildOverview(&cohort)
		if e != nil {
			return preset, e
		}
	}
	if e = s.checkpoint("preset-prepared"); e != nil {
		return preset, e
	}
	if e = s.publish.LockContext(ctx); e != nil {
		return preset, e
	}
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return preset, ErrNeedsRestart
	}
	root, count := s.overviewRoot(), s.overviewCount
	fresh, e := s.presetAdmission(ctx, root, name)
	if e != nil {
		return preset, e
	}
	// Another registration/preparation may have installed the same projection.
	_, preparedErr = s.preparedOverviewAt(ctx, normalized, root)
	if preparedErr != nil && preparedErr != ErrNotFound {
		return preset, preparedErr
	}
	needed := 0
	if fresh {
		needed++
	}
	if preparedErr == ErrNotFound {
		needed++
	}
	for count+needed > PreparedOverviewLimit {
		root, count, e = s.evictOverviewProjection(ctx, root, map[string]bool{overviewKey(normalized): true})
		if e != nil {
			return preset, e
		}
	}
	additions := map[string]string{}
	if preparedErr == ErrNotFound {
		object, err := s.put(view)
		if err != nil {
			return preset, err
		}
		additions[overviewKey(normalized)] = object
	}
	object, e := s.put(preset)
	if e != nil {
		return preset, e
	}
	additions[presetPrefix+name] = object
	root, e = s.mapSetMany(ctx, root, additions, 0)
	if e != nil {
		return preset, e
	}
	if e = s.checkpoint("preset-before-commit"); e != nil {
		return preset, e
	}
	if e = ctx.Err(); e != nil {
		return preset, e
	}
	if e = s.db.Set(key("overviews"), []byte(root), pebble.Sync); e != nil {
		s.poisoned.Store(true)
		return preset, e
	}
	if e = s.checkpoint("preset-after-commit"); e != nil {
		s.poisoned.Store(true)
		return preset, e
	}
	if e = s.portableRoots(s.Current(), s.registrationRoot(), root); e != nil {
		s.poisoned.Store(true)
		return preset, e
	}
	s.mu.Lock()
	s.overviews = root
	s.overviewCount = count + needed
	s.mu.Unlock()
	return preset, nil
}

// Checks only configuration admission; derived projection capacity can be
// reclaimed in the same unpublished candidate without touching measurements.
func (s *Store) presetAdmission(ctx context.Context, root, name string) (bool, error) {
	presets, e := s.overviewPresets(ctx, root)
	if e != nil {
		return false, e
	}
	for _, preset := range presets {
		if preset.Name == name {
			return false, nil
		}
	}
	if len(presets) >= OverviewPresetLimit {
		return false, ErrQuota
	}
	return true, nil
}

// Preparation reads an immutable candidate through a temporary application
// revision registry. It exposes no pending revision to live readers and retains
// no Pebble snapshot. All derived objects are durable before the single batch.
func (s *Store) prepareRevisionOverviews(ctx context.Context, id string, rev Revision) (string, int, error) {
	root := s.overviewRoot()
	count := s.overviewCount
	presets, e := s.overviewPresets(ctx, root)
	if e != nil {
		return root, count, e
	}
	if len(presets) == 0 {
		return root, count, nil
	}
	s.mu.RLock()
	published := make(map[string]Revision, len(s.published)+1)
	for key, value := range s.published {
		published[key] = value
	}
	s.mu.RUnlock()
	published[id] = rev
	reader := &Store{root: s.root, objects: s.objects, current: id, published: published}
	protected := map[string]bool{}
	for _, preset := range presets {
		if preset.Version != comparison.Version {
			continue
		}
		scope := preset.Scope
		scope.Revision = id
		cohort, e := reader.ComputeCohort(ctx, scope)
		if e != nil {
			return root, count, e
		}
		view, e := reader.BuildOverview(&cohort)
		if e != nil {
			return root, count, e
		}
		keyID := overviewKey(view.Scope)
		protected[keyID] = true
		old, e := s.mapGet(root, keyID)
		if e != nil {
			return root, count, e
		}
		if old != "" {
			continue
		}
		if count >= PreparedOverviewLimit {
			var e error
			root, count, e = s.evictOverviewProjection(ctx, root, protected)
			if e != nil {
				return root, count, e
			}
		}
		record, e := s.put(view)
		if e != nil {
			return root, count, e
		}
		root, e = s.mapSet(root, keyID, record, 0)
		if e != nil {
			return root, count, e
		}
		count++
	}
	return root, count, nil
}

func (s *Store) OverviewPresets(ctx context.Context) ([]OverviewPreset, error) {
	if e := s.publish.LockContext(ctx); e != nil {
		return nil, e
	}
	defer s.publish.Unlock()
	return s.overviewPresets(ctx, s.overviewRoot())
}
func (s *Store) DeleteOverviewPreset(ctx context.Context, name string) error {
	if !wire.IsIdentity(name) {
		return wire.Invalid("invalid preset name")
	}
	if e := s.publish.LockContext(ctx); e != nil {
		return e
	}
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return ErrNeedsRestart
	}
	root := s.overviewRoot()
	id, e := s.mapGet(root, presetPrefix+name)
	if e != nil {
		return e
	}
	if id == "" {
		return ErrNotFound
	}
	entries := map[string]string{}
	budget := ScanLimit
	if e = s.walk(root, &budget, func(k, v string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if k != presetPrefix+name {
			entries[k] = v
		}
		return nil
	}); e != nil {
		return e
	}
	next, e := s.mapSetMany(ctx, "", entries, 0)
	if e != nil {
		return e
	}
	batch := s.db.NewBatch()
	defer batch.Close()
	if next == "" {
		e = batch.Delete(key("overviews"), nil)
	} else {
		e = batch.Set(key("overviews"), []byte(next), nil)
	}
	if e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	if e = batch.Commit(pebble.Sync); e != nil {
		s.poisoned.Store(true)
		return e
	}
	if e = s.portableRoots(s.Current(), s.registrationRoot(), next); e != nil {
		s.poisoned.Store(true)
		return e
	}
	s.mu.Lock()
	s.overviews = next
	s.overviewCount--
	s.mu.Unlock()
	return nil
}

// Prepared projections are replaceable derived data. At capacity, eviction
// removes one projection reference, never a preset or measurement/source record.
// Old overview URLs remain valid through the ordinary complete-scope fallback.
func (s *Store) evictOverviewProjection(ctx context.Context, root string, protected map[string]bool) (string, int, error) {
	entries := map[string]string{}
	budget := ScanLimit
	keys := []string{}
	if e := s.walk(root, &budget, func(k, v string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		entries[k] = v
		if !strings.HasPrefix(k, presetPrefix) && !protected[k] {
			keys = append(keys, k)
		}
		return nil
	}); e != nil {
		return root, 0, e
	}
	if len(keys) == 0 {
		return root, len(entries), ErrQuota
	}
	sort.Strings(keys)
	delete(entries, keys[0])
	next, e := s.mapSetMany(ctx, "", entries, 0)
	return next, len(entries), e
}
