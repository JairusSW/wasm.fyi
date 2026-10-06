package store

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Preserve producer claims as inspectable records, but do not turn contradictory
// observation identities into a compatible website comparison population.
func TestCohortRejectsContradictoryRSSIdentity(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*wire.ObservationIdentity)
	}{
		{"scope", func(o *wire.ObservationIdentity) { o.Scope = "guest_logical_memory" }},
		{"profile", func(o *wire.ObservationIdentity) { o.Profile = "timing" }},
		{"lifetime-boundary", func(o *wire.ObservationIdentity) { o.Phase = "steady/process_lifetime" }},
		{"quality", func(o *wire.ObservationIdentity) { o.Quality = "kernel_accounted_peak" }},
		{"denominator", func(o *wire.ObservationIdentity) { o.Denominator = "per_operation" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			s := openTest(t, t.TempDir())
			defer s.Close()
			job, objects, e := testutil.CohortFixture("rss-identity-"+test.name, time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Metric: "process.rss", Value: 10}})
			if e != nil {
				t.Fatal(e)
			}
			manifest := &job.Exports[0].Manifest
			for i, o := range manifest.Objects {
				if o.Kind != "record" {
					continue
				}
				var record wire.Record
				if e = wire.Decode(objects[o.SHA256], &record); e != nil {
					t.Fatal(e)
				}
				if record.Kind != "result" {
					continue
				}
				var result wire.Result
				if e = wire.Decode(record.Data, &result); e != nil {
					t.Fatal(e)
				}
				test.mutate(&result.MeasurementMethod.Observations[0])
				result.MeasurementMethodID = result.MeasurementMethod.ID()
				record.Data, e = wire.Encode(result)
				if e != nil {
					t.Fatal(e)
				}
				record.ID = wire.Hash(record.Data)
				body, e := wire.Encode(record)
				if e != nil {
					t.Fatal(e)
				}
				delete(objects, o.SHA256)
				o.SHA256, o.Bytes = wire.Hash(body), len(body)
				objects[o.SHA256] = body
				manifest.Objects[i] = o
			}
			body, e := wire.Encode(manifest)
			if e != nil {
				t.Fatal(e)
			}
			job.Exports[0].SHA256 = wire.Hash(body)
			for id, body := range objects {
				if e = s.Install(id, bytes.NewReader(body)); e != nil {
					t.Fatal(e)
				}
			}
			id, e := s.Submit(job)
			if e != nil {
				t.Fatal(e)
			}
			revision, e := s.Commit(id)
			if e != nil {
				t.Fatal("raw producer record lost", e)
			}
			rows, e := s.Results(Query{Revision: revision}, false)
			if e != nil || len(rows) != 1 {
				t.Fatal("raw claims not inspectable", e)
			}
			scope := cohortScope(t, s, revision)
			scope.Policy = "available-rss-arithmetic-v1"
			scope.Collectors = "require-recorded"
			if _, e = s.ComputeCohort(context.Background(), scope); e == nil {
				t.Fatal("contradictory RSS identity entered cohort")
			}
		})
	}
}

func TestCohortRSSPreservesTimingAndMemorySourceProfiles(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := publishCohort(t, s, "rss-source-profiles", []testutil.CohortCell{
		{Runtime: "a", Workload: "fixture/one", Metric: "process.rss", Scenario: "compile", SourceProfile: "timing", Value: 10},
		{Runtime: "b", Workload: "fixture/one", Metric: "process.rss", Scenario: "compile", SourceProfile: "timing", Value: 20},
		{Runtime: "a", Workload: "fixture/one", Metric: "process.rss", Scenario: "steady", SourceProfile: "memory", Value: 30},
		{Runtime: "b", Workload: "fixture/one", Metric: "process.rss", Scenario: "steady", SourceProfile: "memory", Value: 60},
	})
	scope := cohortScope(t, s, rev)
	scope.Policy = "available-rss-arithmetic-v1"
	scope.Collectors = "require-recorded"
	scope.Selectors = nil
	rows, e := s.Results(Query{Revision: rev}, false)
	if e != nil {
		t.Fatal(e)
	}
	selectors := map[CohortSelector]bool{}
	for _, record := range rows {
		var r wire.Result
		if e = wire.Decode(record.Data, &r); e != nil {
			t.Fatal(e)
		}
		selector := CohortSelector{r.MetricDefinitionID, r.MeasurementMethodID, r.AnalysisVersion}
		if !selectors[selector] {
			scope.Selectors = append(scope.Selectors, selector)
			selectors[selector] = true
		}
	}
	c, e := s.ComputeCohort(context.Background(), scope)
	if e != nil {
		t.Fatal(e)
	}
	if len(c.Comparison.Populations) != 2 {
		t.Fatal("source profiles lost", c)
	}
	for _, p := range c.Comparison.Populations {
		want := 20.0
		if p.Configuration != scope.Baseline {
			want = 40
		}
		if p.Count != 2 || p.Value == nil || *p.Value != want {
			t.Fatal("current RSS population changed", p)
		}
		profiles := map[string]bool{}
		for _, m := range p.Members {
			record, e := s.Record(rev, "result", m.Cell.Result)
			if e != nil {
				t.Fatal(e)
			}
			var r wire.Result
			if e = wire.Decode(record.Data, &r); e != nil {
				t.Fatal(e)
			}
			profiles[r.Profile] = true
		}
		if !profiles["timing"] || !profiles["memory"] {
			t.Fatal("source pass identity hidden", profiles)
		}
	}
}
