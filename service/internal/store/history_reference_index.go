package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

// Current reference populations use exactly the existing host selection and
// admission policy. Preparing them avoids replaying immutable selection trees
// for each history metric on the HTTP request deadline.
func historyReferenceKey(q Query) []byte {
	q.Workload = ""
	q.Definition = ""
	q.Method = ""
	q.Track = ""
	q.Runtime = ""
	q.Contract = ""
	q.Sort = "catalog"
	if q.Metric != "time.wall" {
		q.Profile = ""
	}
	q.Limit = 0
	q.Selection = "current"
	if len(q.Environments) > 0 {
		q.Environment = q.Environments[0]
	}
	raw, _ := wire.Encode(q)
	return historyReadKey("reference-v2", wire.Hash(raw))
}

func (s *Store) PrepareHistoryReferences(ctx context.Context, directory string, queries []Query, progress func(int, int)) error {
	db, err := pebble.Open(directory, &pebble.Options{})
	if err != nil {
		return err
	}
	defer db.Close()
	marker, closeMarker, err := db.Get([]byte("complete"))
	if err != nil {
		return err
	}
	valid := string(marker) == historyReadVersion+":"+s.Current()
	closeMarker.Close()
	if !valid {
		return fmt.Errorf("history reference index revision/version differs")
	}
	s = s.queryStoreWithCacheBytes(2 << 30)
	for i, q := range queries {
		if err = ctx.Err(); err != nil {
			return err
		}
		if q.Revision != s.Current() {
			return fmt.Errorf("history reference revision differs")
		}
		key := historyReferenceKey(q)
		if _, closer, e := db.Get(key); e == nil {
			closer.Close()
			continue
		} else if e != pebble.ErrNotFound {
			return e
		}
		rows, e := s.ResultsContext(ctx, q, false)
		if e != nil {
			return e
		}
		prepared := make([]historyReadRow, 0, len(rows))
		for _, record := range rows {
			if err = ctx.Err(); err != nil {
				return err
			}
			var value wire.Result
			if err = json.Unmarshal(record.Data, &value); err != nil {
				return err
			}
			status, reason, e := s.SummaryEligibility(ctx, q.Revision, value)
			if e != nil {
				return e
			}
			value.Evidence = nil
			record.Data, err = wire.Encode(value)
			if err != nil {
				return err
			}
			prepared = append(prepared, historyReadRow{record, status, reason})
		}
		raw, e := wire.Encode(prepared)
		if e != nil {
			return e
		}
		if len(raw) > 32<<20 {
			return ErrLimit
		}
		// One complete population is installed atomically; a failed preparation
		// exposes no partial population and can reuse preceding complete scopes.
		if e = db.Set(key, raw, pebble.Sync); e != nil {
			return e
		}
		if progress != nil {
			progress(i+1, len(rows))
		}
	}
	return nil
}

func (h *HistoryReadIndex) Reference(ctx context.Context, q Query) (HistoryReadSelection, bool, error) {
	return h.reference(ctx, q, false)
}
func (h *HistoryReadIndex) reference(ctx context.Context, q Query, scientific bool) (HistoryReadSelection, bool, error) {
	output := HistoryReadSelection{Rows: []wire.Record{}, Eligibility: map[string][2]string{}}
	if q.Revision != h.Revision {
		return output, false, nil
	}
	if err := ctx.Err(); err != nil {
		return output, false, err
	}
	raw, closer, err := h.db.Get(historyReferenceKey(q))
	// A complete metric population also serves narrower scenario requests.
	// Filtering below retains the exact requested scenario and source method.
	if err == pebble.ErrNotFound && q.Scenario != "" {
		population := q
		population.Scenario = ""
		raw, closer, err = h.db.Get(historyReferenceKey(population))
	}
	if err == pebble.ErrNotFound {
		return output, false, nil
	}
	if err != nil {
		return output, false, err
	}
	defer closer.Close()
	if len(raw) > 32<<20 {
		return output, false, ErrLimit
	}
	var rows []historyReadRow
	if err = json.Unmarshal(raw, &rows); err != nil {
		return output, false, err
	}
	for _, row := range rows {
		if err = ctx.Err(); err != nil {
			return output, false, err
		}
		var value wire.Result
		if err = json.Unmarshal(row.Record.Data, &value); err != nil {
			return output, false, err
		}
		filter := q
		if len(q.Environments) > 0 {
			filter.Environment = ""
		}
		if !filter.Matches(value) {
			continue
		}
		if !scientific {
			value.MeasurementMethod = nil
			value.Evidence = nil
			row.Record.Data, err = wire.Encode(value)
			if err != nil {
				return output, false, err
			}
		}
		output.Rows = append(output.Rows, row.Record)
		output.Eligibility[row.Record.ID] = [2]string{row.Status, row.Reason}
	}
	return output, true, nil
}

// EnablePreparedSelections is installed before HTTP serving starts. Scientific
// queries consume the same complete current populations prepared by ResultsContext.
func (s *Store) EnablePreparedSelections(index *HistoryReadIndex) { s.preparedSelection = index }
func (s *Store) preparedCurrent(ctx context.Context, q Query) ([]wire.Record, bool, error) {
	if s.preparedSelection == nil || q.Selection != "" && q.Selection != "current" && q.Selection != "s1" || q.Configuration != "" || q.From != "" || q.Until != "" {
		return nil, false, nil
	}
	if len(q.Environments) > 0 {
		ids, err := s.NormalizeHostEnvironments(q.Revision, q.Environment, q.Environments)
		if err != nil {
			return nil, false, err
		}
		q.Environments = ids
	}
	selected, found, err := s.preparedSelection.reference(ctx, q, true)
	if err != nil || !found {
		return nil, found, err
	}
	if q.Sort == "value" || q.Sort == "-value" {
		sortResultRecords(selected.Rows, q, false)
	}
	return selected.Rows, true, nil
}
