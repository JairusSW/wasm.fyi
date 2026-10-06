package api

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"strconv"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const historySeriesVersion = "observed-minmax-v1"

type HistorySeries struct {
	Version   string        `json:"version"`
	Scope     store.Query   `json:"scope"`
	TimeAxis  string        `json:"timeAxis"`
	Reduction string        `json:"reduction"`
	GapPolicy string        `json:"gapPolicy"`
	RawCount  int           `json:"rawCount"`
	MaxPoints int           `json:"maxPoints"`
	Items     []wire.Record `json:"items"`
}

func (a *API) historySeries(w http.ResponseWriter, r *http.Request) {
	var scope store.Query
	if e := wire.Decode([]byte(r.URL.Query().Get("scope")), &scope); e != nil {
		problem(w, r, wire.Invalid("invalid history series scope"))
		return
	}
	if r.URL.Query().Get("version") != historySeriesVersion {
		problem(w, r, wire.Invalid("explicit history series version required"))
		return
	}
	for _, id := range []string{scope.Revision, scope.Environment, scope.Track, scope.Contract, scope.Definition, scope.Method} {
		if !wire.IsHash(id) {
			problem(w, r, wire.Invalid("history series requires exact revision/environment/track/contract/definition/method"))
			return
		}
	}
	for _, text := range []string{scope.Runtime, scope.Workload, scope.Metric, scope.Scenario, scope.Profile, scope.Statistic} {
		if len(text) > 256 {
			problem(w, r, wire.Invalid("history series selector exceeds ceiling"))
			return
		}
	}
	if scope.Configuration != "" && !wire.IsHash(scope.Configuration) {
		problem(w, r, wire.Invalid("invalid history configuration"))
		return
	}
	if scope.Scenario == "" || scope.Profile == "" || scope.Statistic == "" || scope.From == "" || scope.Until == "" || scope.Limit != 0 || scope.Selection != "" || scope.Sort != "" && scope.Sort != "catalog" {
		problem(w, r, wire.Invalid("history series requires explicit metric context and window"))
		return
	}
	scope.Sort = "catalog"
	normalized, e := store.NormalizeHistoryQuery(scope)
	if e != nil {
		problem(w, r, e)
		return
	}
	scope = normalized
	max := 200
	if raw := r.URL.Query().Get("maxPoints"); raw != "" {
		max, e = strconv.Atoi(raw)
		if e != nil || max < 8 || max > 1000 {
			problem(w, r, wire.Invalid("history series maxPoints must be 8..1000"))
			return
		}
	}
	select {
	case a.calculating <- struct{}{}:
		defer func() { <-a.calculating }()
	default:
		respond(w, r, 429, map[string]string{"error": "history computation concurrency limit"}, false)
		return
	}
	rows, e := a.resultRows(r.Context(), scope, true)
	if e != nil {
		if e == errQueryBusy {
			respond(w, r, 429, map[string]string{"error": e.Error()}, false)
		} else {
			problem(w, r, e)
		}
		return
	}
	points, e := reduceHistory(r.Context(), rows, max)
	if e != nil {
		problem(w, r, e)
		return
	}
	reduction := "raw"
	if len(points) < len(rows) {
		reduction = "ordered-observation-buckets"
	}
	respond(w, r, 200, HistorySeries{historySeriesVersion, scope, "source-report-created", reduction, "retain-nonnumeric-and-neighbors", len(rows), max, points}, true)
}

// Select original records only. Each bucket keeps first/last and exact numeric
// extrema; gaps and their neighbors are mandatory. No point or interval is made.
func reduceHistory(ctx context.Context, rows []wire.Record, max int) ([]wire.Record, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if len(rows) <= max {
		return rows, nil
	}
	keep := map[int]bool{0: true, len(rows) - 1: true}
	numbers := make([]*big.Rat, len(rows))
	for i, row := range rows {
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		number, ok := historyNumber(row)
		numbers[i] = number
		if !ok {
			keep[i] = true
			if i > 0 {
				keep[i-1] = true
			}
			if i+1 < len(rows) {
				keep[i+1] = true
			}
		}
	}
	if len(keep) > max {
		return nil, store.ErrLimit
	}
	slots := max - len(keep)
	buckets := slots / 4
	if buckets == 0 {
		return nil, store.ErrLimit
	}
	for bucket := 0; bucket < buckets; bucket++ {
		start, end := bucket*len(rows)/buckets, (bucket+1)*len(rows)/buckets
		keep[start] = true
		keep[end-1] = true
		low, high := -1, -1
		for i := start; i < end; i++ {
			if e := ctx.Err(); e != nil {
				return nil, e
			}
			v := numbers[i]
			if v == nil {
				continue
			}
			if low < 0 {
				low = i
				high = i
				continue
			}
			l, h := numbers[low], numbers[high]
			if v.Cmp(l) < 0 {
				low = i
			}
			if v.Cmp(h) > 0 {
				high = i
			}
		}
		if low >= 0 {
			keep[low] = true
			keep[high] = true
		}
	}
	out := make([]wire.Record, 0, len(keep))
	for i, row := range rows {
		if keep[i] {
			out = append(out, row)
		}
	}
	return out, nil
}
func historyNumber(row wire.Record) (*big.Rat, bool) {
	var result wire.Result
	if json.Unmarshal(row.Data, &result) != nil {
		return nil, false
	}
	var summary map[string]json.RawMessage
	if json.Unmarshal(result.Summary, &summary) != nil {
		return nil, false
	}
	var status string
	_ = json.Unmarshal(summary["status"], &status)
	if status != "" && status != "available" {
		return nil, false
	}
	return store.ExactResultValue(row)
}
