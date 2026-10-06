package store

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const HistoryIndexVersion = "utc-month-observations-v1"

func NormalizeHistoryQuery(q Query) (Query, error) {
	start, end, _, e := historyWindow(q, true)
	if e != nil {
		return q, e
	}
	if q.From != "" {
		q.From = start.Format(time.RFC3339Nano)
		q.Until = end.Format(time.RFC3339Nano)
	}
	return q, nil
}

func historyWindow(q Query, historical bool) (time.Time, time.Time, []string, error) {
	var start, end time.Time
	if q.From == "" && q.Until == "" {
		return start, end, nil, nil
	}
	if !historical || q.From == "" || q.Until == "" {
		return start, end, nil, wire.Invalid("history window requires from and until")
	}
	var e error
	start, e = time.Parse(time.RFC3339Nano, q.From)
	if e != nil {
		return start, end, nil, wire.Invalid("invalid history start")
	}
	end, e = time.Parse(time.RFC3339Nano, q.Until)
	if e != nil || !start.Before(end) {
		return start, end, nil, wire.Invalid("invalid history end")
	}
	start, end = start.UTC(), end.UTC()
	months := []string{}
	month := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
	for month.Before(end) {
		if len(months) >= 120 {
			return start, end, nil, wire.Invalid("history window exceeds 120 months")
		}
		months = append(months, month.Format("2006-01"))
		month = month.AddDate(0, 1, 0)
	}
	return start, end, months, nil
}
func (s *Store) indexHistory(ctx context.Context, rev *Revision, newRecords map[string]wire.Record) error {
	updates := map[string]map[string]string{}
	add := func(record wire.Record) error {
		if record.Kind != "result" {
			return nil
		}
		if e := ctx.Err(); e != nil {
			return e
		}
		var v wire.Result
		if e := wire.Decode(record.Data, &v); e != nil {
			return e
		}
		observation, e := observationID(record)
		if e != nil {
			return e
		}
		entry, _ := wire.Encode([]string{v.Created.UTC().Format(time.RFC3339Nano), observation})
		key := indexKey("history-month", v.Cell(), v.Created.UTC().Format("2006-01"))
		if updates[key] == nil {
			updates[key] = map[string]string{}
		}
		digest, e := s.mapGet(rev.Catalog, "result:"+record.ID)
		if e != nil {
			return e
		}
		if digest == "" {
			return ErrNotFound
		}
		updates[key][string(entry)] = digest
		return nil
	}
	if rev.HistoryIndexVersion == "" {
		budget := ScanLimit
		decoded := 0
		if e := s.indexedCatalog(ctx, *rev, "result", &budget, func(record wire.Record) error {
			decoded += len(record.Data)
			if decoded > 32<<20 {
				return ErrLimit
			}
			return add(record)
		}); e != nil {
			return e
		}
	} else if rev.HistoryIndexVersion == HistoryIndexVersion {
		for _, record := range newRecords {
			if e := add(record); e != nil {
				return e
			}
		}
	} else {
		return wire.Invalid("unsupported history index")
	}
	keys := []string{}
	for key := range updates {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	directory := map[string]string{}
	for _, key := range keys {
		if e := ctx.Err(); e != nil {
			return e
		}
		set, e := s.indexGet(rev.Indexes, key)
		if e != nil {
			return e
		}
		for entry := range updates[key] {
			prior, e := s.mapGet(set.Root, entry)
			if e != nil {
				return e
			}
			if prior == "" {
				set.Count++
			} else {
				updates[key][entry] = prior
			}
		}
		set.Root, e = s.mapSetMany(ctx, set.Root, updates[key], 0)
		if e != nil {
			return e
		}
		id, e := s.put(set)
		if e != nil {
			return e
		}
		directory[key] = id
	}
	root, e := s.mapSetMany(ctx, rev.Indexes, directory, 0)
	if e != nil {
		return e
	}
	rev.Indexes = root
	rev.HistoryIndexVersion = HistoryIndexVersion
	return nil
}
func (s *Store) historyWindowEntries(ctx context.Context, rev Revision, cell string, start, end time.Time, months []string, budget *int, add func(string) error) error {
	for _, month := range months {
		if e := ctx.Err(); e != nil {
			return e
		}
		*budget--
		if *budget < 0 {
			return ErrLimit
		}
		set, e := s.indexGet(rev.Indexes, indexKey("history-month", cell, month))
		if e != nil {
			return e
		}
		if e = s.walk(set.Root, budget, func(key, id string) error {
			if e := ctx.Err(); e != nil {
				return e
			}
			var tuple []string
			if e := json.Unmarshal([]byte(key), &tuple); e != nil || len(tuple) != 2 || !wire.IsHash(tuple[1]) {
				return wire.Invalid("invalid history posting")
			}
			created, e := time.Parse(time.RFC3339Nano, tuple[0])
			if e != nil {
				return wire.Invalid("invalid history posting date")
			}
			if created.Before(start) || !created.Before(end) {
				return nil
			}
			var record wire.Record
			if e := s.load(id, &record); e != nil {
				return e
			}
			return add(record.ID)
		}); e != nil {
			return e
		}
	}
	return nil
}
