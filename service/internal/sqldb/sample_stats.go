package sqldb

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"math"
	"strings"
)

type SampleStats struct {
	Count  int      `json:"count"`
	Mean   float64  `json:"mean"`
	StdDev *float64 `json:"stdDev"`
	Min    float64  `json:"min"`
	Max    float64  `json:"max"`
}

// Welford runs on retained observations. Scaling avoids square overflow for
// valid large IEEE values; no stored vector or measurement identity is changed.
func retainedStats(samples []float64, start int) (*SampleStats, error) {
	if start < 0 || start > len(samples) {
		return nil, fmt.Errorf("invalid retained sample offset")
	}
	samples = samples[start:]
	if len(samples) == 0 {
		return nil, nil
	}
	stats := &SampleStats{Count: len(samples), Min: samples[0], Max: samples[0]}
	for _, v := range samples {
		if v < 0 || math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, fmt.Errorf("invalid recorded sample")
		}
		if v < stats.Min {
			stats.Min = v
		}
		if v > stats.Max {
			stats.Max = v
		}
	}
	scale := stats.Max
	mean, m2 := 0.0, 0.0
	if scale > 0 {
		for i, v := range samples {
			x := v / scale
			delta := x - mean
			mean += delta / float64(i+1)
			m2 += delta * (x - mean)
		}
	}
	stats.Mean = mean * scale
	if stats.Count > 1 {
		sd := math.Sqrt(math.Max(0, m2)/float64(stats.Count-1)) * scale
		stats.StdDev = &sd
	}
	return stats, nil
}
func putSampleStats(ctx context.Context, tx *sql.Tx, id int64, samples []float64, policy *benchdb.Sampling) error {
	start := 0
	if policy != nil {
		start = policy.RetainedStart
	}
	v, e := retainedStats(samples, start)
	if e != nil {
		return e
	}
	if v == nil {
		return nil
	}
	_, e = tx.ExecContext(ctx, "INSERT OR IGNORE INTO sample_statistics(observation_id,count,mean,std_dev,min,max) VALUES(?,?,?,?,?,?)", id, v.Count, v.Mean, v.StdDev, v.Min, v.Max)
	return e
}
func backfillSampleStats(ctx context.Context, tx *sql.Tx) error {
	rows, e := tx.QueryContext(ctx, "SELECT o.id,v.data,v.count,sp.data FROM observations o JOIN sample_vectors v ON v.id=o.samples_id LEFT JOIN sampling_policies sp ON sp.id=o.sampling_id")
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var raw, policyRaw []byte
		var count int
		if e = rows.Scan(&id, &raw, &count, &policyRaw); e != nil {
			return e
		}
		if len(raw) != count*8 {
			return fmt.Errorf("sample vector count mismatch")
		}
		var policy *benchdb.Sampling
		if policyRaw != nil {
			if e = json.Unmarshal(policyRaw, &policy); e != nil {
				return e
			}
		}
		if e = putSampleStats(ctx, tx, id, unvector(raw), policy); e != nil {
			return e
		}
	}
	if e = rows.Err(); e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO metadata(key,value) VALUES('sample-statistics-v3','complete')")
	return e
}
func loadCellStats(ctx context.Context, q queryer, cells []Cell) error {
	byID := map[int64][]int{}
	ids := []int64{}
	for i, c := range cells {
		if _, ok := byID[c.ObservationID]; !ok {
			ids = append(ids, c.ObservationID)
		}
		byID[c.ObservationID] = append(byID[c.ObservationID], i)
	}
	for start := 0; start < len(ids); start += 400 {
		end := start + 400
		if end > len(ids) {
			end = len(ids)
		}
		args := make([]any, end-start)
		marks := make([]string, len(args))
		for i, id := range ids[start:end] {
			args[i] = id
			marks[i] = "?"
		}
		rows, e := q.QueryContext(ctx, "SELECT observation_id,count,mean,std_dev,min,max FROM sample_statistics WHERE observation_id IN("+strings.Join(marks, ",")+")", args...)
		if e != nil {
			return e
		}
		for rows.Next() {
			var id int64
			var v SampleStats
			var sd sql.NullFloat64
			if e = rows.Scan(&id, &v.Count, &v.Mean, &sd, &v.Min, &v.Max); e != nil {
				rows.Close()
				return e
			}
			if sd.Valid {
				v.StdDev = &sd.Float64
			}
			for _, i := range byID[id] {
				copy := v
				cells[i].SampleStats = &copy
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
	}
	return nil
}
