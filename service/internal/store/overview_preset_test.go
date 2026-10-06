package store

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/cockroachdb/pebble/v2"
)

func TestOverviewPresetPublicationAndRebuild(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s := openTest(t, filepath.Join(root, "live"))
	defer s.Close()
	first := publishCohort(t, s, "first-preset", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}, {Runtime: "b", Workload: "fixture/one", Value: 16}})
	scope := cohortScope(t, s, first)
	preset, e := s.RegisterOverviewPreset(ctx, "execution", scope)
	if e != nil || preset.Scope.Revision != "" || preset.SeedRevision != first {
		t.Fatal(preset, e)
	}
	next := publishCohort(t, s, "second-preset", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/two", Value: 16}, {Runtime: "b", Workload: "fixture/two", Value: 64}})
	scope.Revision = next
	prepared, e := s.PreparedOverview(ctx, scope)
	if e != nil {
		t.Fatal("publication omitted preset", e)
	}
	cohort, e := s.ComputeCohort(ctx, scope)
	if e != nil {
		t.Fatal(e)
	}
	expected, e := s.BuildOverview(&cohort)
	if e != nil || !reflect.DeepEqual(prepared, expected) {
		t.Fatal("automatic projection drift", e)
	}
	backup := filepath.Join(root, "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(root, "rebuilt")
	if e = Rebuild(backup, rebuilt, "fixture"); e != nil {
		t.Fatal(e)
	}
	copy, e := Open(rebuilt, "fixture")
	if e != nil {
		t.Fatal(e)
	}
	defer copy.Close()
	presets, e := copy.overviewPresets(ctx, copy.overviewRoot())
	if e != nil || len(presets) != 1 || presets[0].Name != "execution" {
		t.Fatal(presets, e)
	}
	if e = copy.DeleteOverviewPreset(ctx, "execution"); e != nil {
		t.Fatal(e)
	}
	if list, e := copy.OverviewPresets(ctx); e != nil || len(list) != 0 {
		t.Fatal(list, e)
	}
	if _, e = copy.PreparedOverview(ctx, scope); e != nil {
		t.Fatal("removal erased historical projection", e)
	}
	if _, e = copy.RegisterOverviewPreset(ctx, "execution", scope); e != nil {
		t.Fatal(e)
	}
	latest := publishCohort(t, copy, "rebuilt-preset", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/three", Value: 9}, {Runtime: "b", Workload: "fixture/three", Value: 36}})
	scope.Revision = latest
	if _, e = copy.PreparedOverview(ctx, scope); e != nil {
		t.Fatal("rebuilt preset did not prepare next publication", e)
	}
}
func TestOverviewPresetFailureKeepsRevisionHidden(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	first := publishCohort(t, s, "preset-fault-seed", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}, {Runtime: "b", Workload: "fixture/one", Value: 16}})
	scope := cohortScope(t, s, first)
	if _, e := s.RegisterOverviewPreset(ctx, "execution", scope); e != nil {
		t.Fatal(e)
	}
	job, objects, e := testutil.CohortFixture("preset-fault-new", time.Date(2026, 10, 6, 1, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "a", Workload: "fixture/two", Value: 16}, {Runtime: "b", Workload: "fixture/two", Value: 64}})
	if e != nil {
		t.Fatal(e)
	}
	for hash, body := range objects {
		if e = s.Install(hash, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	injected := errors.New("prepared projection fault")
	s.fail = func(stage string) error {
		if stage == "prepared-overviews" {
			return injected
		}
		return nil
	}
	if _, e = s.CommitContext(ctx, id); !errors.Is(e, injected) {
		t.Fatal(e)
	}
	if s.Current() != first {
		t.Fatal("partial publication became current")
	}
	s.fail = nil
	next, e := s.CommitContext(ctx, id)
	if e != nil {
		t.Fatal(e)
	}
	scope.Revision = next
	if _, e = s.PreparedOverview(ctx, scope); e != nil {
		t.Fatal(e)
	}
}

func TestProjectionEvictionProtectsPresetsAndCandidateViews(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	values := map[string]string{presetPrefix + "execution": "preset-object", "aaa": "candidate-view", "bbb": "older-view", "ccc": "other-view"}
	root, e := s.mapSetMany(ctx, "", values, 0)
	if e != nil {
		t.Fatal(e)
	}
	next, count, e := s.evictOverviewProjection(ctx, root, map[string]bool{"aaa": true})
	if e != nil || count != 3 {
		t.Fatal(count, e)
	}
	for key, want := range map[string]string{presetPrefix + "execution": "preset-object", "aaa": "candidate-view", "bbb": "", "ccc": "other-view"} {
		got, e := s.mapGet(next, key)
		if e != nil || got != want {
			t.Fatal(key, got, e)
		}
	}
}

func TestOverviewPresetQuotaRejectsWithoutPublishingProjection(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	revision := publishCohort(t, s, "preset-quota", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}})
	scope := cohortScope(t, s, revision)
	for i := 0; i < OverviewPresetLimit; i++ {
		if _, e := s.RegisterOverviewPreset(ctx, fmt.Sprintf("preset-%d", i), scope); e != nil {
			t.Fatal(e)
		}
	}
	root, count := s.overviewRoot(), s.overviewCount
	fresh := scope
	fresh.Workloads = "all"
	if _, e := s.PreparedOverview(ctx, fresh); !errors.Is(e, ErrNotFound) {
		t.Fatal("test scope already prepared", e)
	}
	if _, e := s.RegisterOverviewPreset(ctx, "over-quota", fresh); !errors.Is(e, ErrQuota) {
		t.Fatal(e)
	}
	if s.overviewRoot() != root || s.overviewCount != count || s.Current() != revision {
		t.Fatal("rejected registration changed published state")
	}
	if _, e := s.PreparedOverview(ctx, fresh); !errors.Is(e, ErrNotFound) {
		t.Fatal("rejected registration published projection", e)
	}
}

func TestOverviewPresetRegistrationCrashIsAtomic(t *testing.T) {
	binary, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	for _, point := range []string{"preset-before-commit", "preset-after-commit"} {
		t.Run(point, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "store")
			s := openTest(t, root)
			first := publishCohort(t, s, "preset-crash-seed", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}})
			scope := cohortScope(t, s, first)
			if e = s.Close(); e != nil {
				t.Fatal(e)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, binary, "-test.run=^TestOverviewPresetCrashHelper$")
			child.Env = append(os.Environ(), "WASMFYI_PRESET_CRASH_ROOT="+root, "WASMFYI_PRESET_CRASH_STAGE="+point)
			output, e := child.CombinedOutput()
			exit, ok := e.(*exec.ExitError)
			if !ok || exit.ExitCode() != 83 {
				t.Fatalf("preset crash boundary missing: %v\n%s", e, output)
			}
			s = openTest(t, root)
			defer s.Close()
			presets, e := s.OverviewPresets(context.Background())
			if e != nil {
				t.Fatal(e)
			}
			_, viewErr := s.PreparedOverview(context.Background(), scope)
			committed := point == "preset-after-commit"
			if committed && (len(presets) != 1 || viewErr != nil) || !committed && (len(presets) != 0 || !errors.Is(viewErr, ErrNotFound)) {
				t.Fatal("partial preset/projection after crash", len(presets), viewErr)
			}
			if s.Current() != first {
				t.Fatal("registration changed measurement revision")
			}
			if _, e = s.RegisterOverviewPreset(context.Background(), "execution", scope); e != nil {
				t.Fatal(e)
			}
			if s.overviewCount != 2 {
				t.Fatal("redelivery duplicated registry entries", s.overviewCount)
			}
			backup := filepath.Join(t.TempDir(), "backup")
			if _, e = s.Backup(context.Background(), backup); e != nil {
				t.Fatal(e)
			}
			rebuilt := filepath.Join(t.TempDir(), "rebuilt")
			if e = Rebuild(backup, rebuilt, "fixture"); e != nil {
				t.Fatal(e)
			}
			recovered := openTest(t, rebuilt)
			defer recovered.Close()
			if p, e := recovered.OverviewPresets(context.Background()); e != nil || len(p) != 1 {
				t.Fatal("preset not portable", e)
			}
			if _, e = recovered.PreparedOverview(context.Background(), scope); e != nil {
				t.Fatal("seed projection not portable", e)
			}
		})
	}
}
func TestOverviewPresetCrashHelper(t *testing.T) {
	root := os.Getenv("WASMFYI_PRESET_CRASH_ROOT")
	if root == "" {
		return
	}
	s := openTest(t, root)
	s.fail = func(point string) error {
		if point == os.Getenv("WASMFYI_PRESET_CRASH_STAGE") {
			os.Exit(83)
		}
		return nil
	}
	if _, e := s.RegisterOverviewPreset(context.Background(), "execution", cohortScope(t, s, s.Current())); e != nil {
		t.Fatal(e)
	}
	t.Fatal("crash boundary not reached")
}

func TestOverviewPresetConcurrentLastSlotDoesNotPublishLoser(t *testing.T) {
	ctx, cancelWork := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelWork()
	s := openTest(t, t.TempDir())
	defer s.Close()
	revision := publishCohort(t, s, "preset-last-slot", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}})
	seed := cohortScope(t, s, revision)
	for i := 0; i < OverviewPresetLimit-1; i++ {
		if _, e := s.RegisterOverviewPreset(ctx, fmt.Sprintf("seed-%d", i), seed); e != nil {
			t.Fatal(e)
		}
	}
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	s.fail = func(point string) error {
		if point == "preset-prepared" {
			started <- struct{}{}
			<-release
		}
		return nil
	}
	scopes := []CohortScope{seed, seed}
	scopes[0].Workloads = "all"
	scopes[1].Contracts = "all-exact-contracts"
	type outcome struct {
		index int
		err   error
	}
	done := make(chan outcome, 2)
	for i, scope := range scopes {
		go func(i int, scope CohortScope) {
			_, e := s.RegisterOverviewPreset(ctx, fmt.Sprintf("candidate-%d", i), scope)
			done <- outcome{i, e}
		}(i, scope)
	}
	// Do not leave helpers blocked if an assertion aborts the test.
	released := false
	completed := 0
	defer func() {
		if !released {
			close(release)
		}
		cancelWork()
		deadline := time.After(10 * time.Second)
		for completed < 2 {
			select {
			case <-done:
				completed++
			case <-deadline:
				return
			}
		}
	}()
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(10 * time.Second):
			t.Fatal("concurrent preparation did not reach barrier")
		}
	}
	readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	_, e := s.PreparedOverview(readCtx, seed)
	cancel()
	if e != nil {
		t.Fatal("preparation held publication lock across computation", e)
	}
	close(release)
	released = true
	winner, loser := -1, -1
	for i := 0; i < 2; i++ {
		select {
		case result := <-done:
			completed++
			if result.err == nil {
				winner = result.index
			} else if errors.Is(result.err, ErrQuota) {
				loser = result.index
			} else {
				t.Fatal(result.err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("concurrent registration did not finish")
		}
	}
	if winner < 0 || loser < 0 {
		t.Fatal("last slot did not admit exactly one registration")
	}
	if _, e = s.PreparedOverview(ctx, scopes[winner]); e != nil {
		t.Fatal("winner missing seed projection", e)
	}
	if _, e = s.PreparedOverview(ctx, scopes[loser]); !errors.Is(e, ErrNotFound) {
		t.Fatal("loser published projection", e)
	}
	presets, e := s.OverviewPresets(ctx)
	if e != nil || len(presets) != OverviewPresetLimit || s.overviewCount != OverviewPresetLimit+2 {
		t.Fatal("quota accounting drift", e, len(presets), s.overviewCount)
	}
}

func TestOverviewPresetCancellationLeavesRegistryUnchanged(t *testing.T) {
	for _, point := range []string{"preset-prepared", "preset-before-commit"} {
		t.Run(point, func(t *testing.T) {
			s := openTest(t, t.TempDir())
			defer s.Close()
			revision := publishCohort(t, s, "preset-canceled", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}})
			scope := cohortScope(t, s, revision)
			root, count := s.overviewRoot(), s.overviewCount
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			s.fail = func(stage string) error {
				if stage == point {
					cancel()
				}
				return nil
			}
			if _, e := s.RegisterOverviewPreset(ctx, "execution", scope); !errors.Is(e, context.Canceled) {
				t.Fatal(e)
			}
			if s.overviewRoot() != root || s.overviewCount != count || s.poisoned.Load() {
				t.Fatal("canceled registration changed published registry")
			}
			s.fail = nil
			if _, e := s.RegisterOverviewPreset(context.Background(), "execution", scope); e != nil {
				t.Fatal("canceled registration did not retry", e)
			}
		})
	}
}

func TestOverviewPresetRegistrationEvictsOnlyDerivedViewsAtCapacity(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	revision := publishCohort(t, s, "preset-projection-capacity", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}})
	scope, e := s.NormalizeCohort(cohortScope(t, s, revision))
	if e != nil {
		t.Fatal(e)
	}
	cohort, e := s.ComputeCohort(ctx, scope)
	if e != nil {
		t.Fatal(e)
	}
	view, e := s.BuildOverview(&cohort)
	if e != nil {
		t.Fatal(e)
	}
	entries := map[string]string{}
	// Valid recoverable historical projections, with explicit synthetic analysis
	// versions; no fake counts or malformed map values stand in for capacity.
	for i := 0; i < PreparedOverviewLimit; i++ {
		old := view
		old.Interpretation.Version = fmt.Sprintf("synthetic-archived-%d", i)
		object, e := s.put(old)
		if e != nil {
			t.Fatal(e)
		}
		entries[overviewVersionKey(scope, old.Interpretation.Version, comparison.CategoryVersion)] = object
	}
	root, e := s.mapSetMany(ctx, "", entries, 0)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.db.Set(key("overviews"), []byte(root), pebble.Sync); e != nil {
		t.Fatal(e)
	}
	s.overviews = root
	s.overviewCount = PreparedOverviewLimit
	if e = s.portableRoots(revision, s.registrationRoot(), root); e != nil {
		t.Fatal(e)
	}
	if _, e = s.RegisterOverviewPreset(ctx, "execution", scope); e != nil {
		t.Fatal("full projection registry prevented registration", e)
	}
	if s.overviewCount != PreparedOverviewLimit || s.Current() != revision {
		t.Fatal("registration crossed storage or measurement boundary")
	}
	if _, e = s.PreparedOverview(ctx, scope); e != nil {
		t.Fatal("seed view missing", e)
	}
	fresh := scope
	fresh.Workloads = "all"
	if _, e = s.RegisterOverviewPreset(ctx, "execution", fresh); e != nil {
		t.Fatal("replacement at capacity failed", e)
	}
	presets, e := s.OverviewPresets(ctx)
	if e != nil || len(presets) != 1 || presets[0].Scope.Workloads != "all" || s.overviewCount != PreparedOverviewLimit {
		t.Fatal("replacement evicted preset or exceeded capacity", e)
	}
	if _, e = s.PreparedOverview(ctx, fresh); e != nil {
		t.Fatal(e)
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "fixture"); e != nil {
		t.Fatal(e)
	}
	recovered := openTest(t, rebuilt)
	defer recovered.Close()
	if recovered.overviewCount != PreparedOverviewLimit {
		t.Fatal("evicted registry not portable")
	}
	if _, e = recovered.PreparedOverview(ctx, fresh); e != nil {
		t.Fatal(e)
	}
}
