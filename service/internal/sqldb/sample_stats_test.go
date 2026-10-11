package sqldb

import (
	"context"
	"database/sql"
	"math"
	"path/filepath"
	"testing"
)

func TestRetainedSampleStatsAreDerivedWithoutChangingAcquisition(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c := fixture()
	c.Results[0].SamplesNs = []float64{100, 100, 100, 100, 100, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	c.Results[0].TimingSamples = 15
	c.Results[0].Sampling.RetainedStart = 5
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	m, e := s.Matrix(ctx, MatrixQuery{Platform: hash(c.Platform), Limit: 10})
	if e != nil || len(m.Items) != 1 {
		t.Fatal(m, e)
	}
	cell := m.Items[0]
	stats := cell.SampleStats
	if stats == nil || stats.Count != 10 || !closeFloat(stats.Mean, 5.5) || stats.StdDev == nil || !closeFloat(*stats.StdDev, math.Sqrt(82.5/9)) || stats.Min != 1 || stats.Max != 10 || cell.TimingSamples != 15 || cell.SamplesNs != nil {
		t.Fatal(cell)
	}
	detail, e := s.Detail(ctx, hash(c.Platform), cell.ObservationID)
	if e != nil || len(detail.SamplesNs) != 15 || detail.SamplesNs[0] != 100 {
		t.Fatal(detail, e)
	}
	single, e := retainedStats([]float64{7}, 0)
	if e != nil || single.StdDev != nil || single.Count != 1 {
		t.Fatal(single, e)
	}
	large, e := retainedStats([]float64{0, 1e308}, 0)
	if e != nil || large.StdDev == nil || math.IsInf(*large.StdDev, 0) {
		t.Fatal(large, e)
	}
}
func TestSampleStatsBackfillOnceAndAbsentSamplesStayAbsent(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	c := fixture()
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	m, e := s.Matrix(ctx, MatrixQuery{Platform: hash(c.Platform), Limit: 10})
	if e != nil {
		t.Fatal(e)
	}
	want := m.Items[0].SampleStats
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	db, e := sql.Open("sqlite3", filepath.Join(dir, "benchmarks.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("DROP TABLE sample_statistics;DELETE FROM metadata WHERE key='sample-statistics-v3';PRAGMA user_version=2"); e != nil {
		t.Fatal(e)
	}
	db.Close()
	s, e = Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	m, e = s.Matrix(ctx, MatrixQuery{Platform: hash(c.Platform), Limit: 10})
	if e != nil || m.Items[0].SampleStats == nil || m.Items[0].SampleStats.Count != want.Count || !closeFloat(*m.Items[0].SampleStats.StdDev, *want.StdDev) {
		t.Fatal(m, e)
	}
	other := fixture()
	other.Results[0].Workload = "app/no-samples"
	other.Results[0].Contract = hash("no-samples")
	other.Results[0].SamplesNs = nil
	other.Results[0].Sampling = nil
	other.Results[0].TimingSamples = 12
	if _, e = s.Put(ctx, other); e != nil {
		t.Fatal(e)
	}
	m, e = s.Matrix(ctx, MatrixQuery{Platform: hash(c.Platform), Limit: 10, Workload: other.Results[0].Workload})
	if e != nil || len(m.Items) != 1 || m.Items[0].SampleStats != nil {
		t.Fatal(m, e)
	}
}
