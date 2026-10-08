package store

// This disposable serving index joins immutable producer summaries to publisher
// target-date bindings. It is not a measurement database or a new analysis: IDs,
// exact numbers, roles, collection times and reused evidence are copied intact.
import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

const historyReadVersion = "target-date-summary-index-v1"

func historyReadKey(parts ...string) []byte { return []byte(strings.Join(parts, "\x00") + "\x00") }

type historyReadRow struct {
	Record wire.Record `json:"record"`
	Status string      `json:"status"`
	Reason string      `json:"reason"`
}
type HistoryReadIndex struct {
	db       *pebble.DB
	Revision string
	ordinals map[string]uint64
}

func (h *HistoryReadIndex) Close() error { return h.db.Close() }
func OpenHistoryReadIndex(directory, revision string) (*HistoryReadIndex, error) {
	cache := pebble.NewCache(256 << 20)
	defer cache.Unref()
	db, e := pebble.Open(directory, &pebble.Options{ReadOnly: true, Cache: cache})
	if e != nil {
		return nil, e
	}
	value, closer, e := db.Get([]byte("complete"))
	if e != nil {
		db.Close()
		return nil, e
	}
	expected := historyReadVersion + ":" + revision
	ok := string(value) == expected
	closer.Close()
	if !ok {
		db.Close()
		return nil, fmt.Errorf("history serving index revision/version differs")
	}
	prefix := historyReadKey("order")
	upper := append([]byte{}, prefix...)
	upper[len(upper)-1]++
	iter, e := db.NewIter(&pebble.IterOptions{LowerBound: prefix, UpperBound: upper})
	if e != nil {
		db.Close()
		return nil, e
	}
	ordinals := map[string]uint64{}
	for valid := iter.First(); valid; valid = iter.Next() {
		parts := strings.Split(string(iter.Key()), "\x00")
		if len(parts) != 3 || !wire.IsHash(parts[1]) || len(iter.Value()) != 8 || len(ordinals) >= 250000 {
			iter.Close()
			db.Close()
			return nil, fmt.Errorf("invalid or oversized history binding order table")
		}
		ordinals[parts[1]] = binary.BigEndian.Uint64(iter.Value())
	}
	if e = iter.Error(); e != nil {
		iter.Close()
		db.Close()
		return nil, e
	}
	if e = iter.Close(); e != nil {
		db.Close()
		return nil, e
	}
	return &HistoryReadIndex{db: db, Revision: revision, ordinals: ordinals}, nil
}

func (s *Store) ReadQueryView() *Store { return s.queryStore() }

func (s *Store) PrepareHistoryReadIndex(ctx context.Context, directory string, progress func(string, int)) error {
	revision := s.Current()
	if old, e := OpenHistoryReadIndex(directory, revision); e == nil {
		old.Close()
		return nil
	}
	s = s.queryStoreWithCacheBytes(2 << 30)
	rev, e := s.Revision(revision)
	if e != nil {
		return e
	}
	temporary := directory + ".building"
	if e = os.RemoveAll(temporary); e != nil {
		return e
	}
	if e = os.MkdirAll(temporary, 0700); e != nil {
		return e
	}
	db, e := pebble.Open(temporary, &pebble.Options{})
	if e != nil {
		return e
	}
	closed := false
	defer func() {
		if !closed {
			db.Close()
		}
	}()
	batch := db.NewBatch()
	defer func() { batch.Close() }()
	put := func(key, value []byte) error {
		if e = batch.Set(key, value, nil); e != nil {
			return e
		}
		if batch.Len() > 1<<20 {
			if e = batch.Commit(pebble.NoSync); e != nil {
				return e
			}
			batch.Close()
			batch = db.NewBatch()
		}
		return nil
	}
	bindings := map[string][]string{}
	set, e := s.indexGet(rev.Indexes, indexKey("published-job", "", ""))
	if e != nil {
		return e
	}
	budget := 5000000
	bindingCount := 0
	e = s.walk(set.Root, &budget, func(_, id string) error {
		if e = ctx.Err(); e != nil {
			return e
		}
		var summary PublishedJob
		if e = s.load(id, &summary); e != nil {
			return e
		}
		if summary.HistoryBindings == 0 {
			return nil
		}
		data, e := s.jobContent(summary.ID)
		if e != nil {
			return e
		}
		var job wire.Job
		if e = json.Unmarshal(data, &job); e != nil {
			return e
		}
		for _, binding := range job.History {
			record, e := s.Record(revision, "report", binding.ReportID)
			if e != nil {
				return e
			}
			created, e := historyReportCreated(record.Data)
			if e != nil {
				return e
			}
			context := HistoryContext{Binding: binding, CollectedAt: created, PublishedAt: summary.PublishedAt, CollectionTimeSource: "source-report-created", InterpretationSource: "trusted-publisher-assertion"}
			raw, e := wire.Encode(context)
			if e != nil {
				return e
			}
			id := wire.Hash(raw)
			if e = put(historyReadKey("binding", id), raw); e != nil {
				return e
			}
			bindings[binding.ReportID+":"+binding.ConfigurationID] = append(bindings[binding.ReportID+":"+binding.ConfigurationID], id)
			if e = put(historyReadKey("order", id), binary.BigEndian.AppendUint64(nil, uint64(bindingCount))); e != nil {
				return e
			}
			bindingCount++
		}
		return nil
	})
	if e != nil {
		return e
	}
	if e = batch.Commit(pebble.NoSync); e != nil {
		return e
	}
	batch.Close()
	batch = db.NewBatch()
	if progress != nil {
		progress("bindings", bindingCount)
	}
	catalog, e := s.indexGet(rev.Indexes, indexKey("catalog", "result", ""))
	if e != nil {
		return e
	}
	if progress != nil {
		progress("catalog", catalog.Count)
	}
	scanned := 0
	records := 0
	seenRecords := map[string]bool{}
	postings := 0
	budget = 5000000
	e = s.indexedCatalog(ctx, rev, "result", &budget, func(record wire.Record) error {
		scanned++
		if scanned%10000 == 0 && progress != nil {
			progress("scanned", scanned)
		}
		var original struct {
			ReportID        string `json:"reportId"`
			ConfigurationID string `json:"configurationId"`
		}
		if e = json.Unmarshal(record.Data, &original); e != nil {
			return e
		}
		// Every canonical observation has its own catalog record. An unbound
		// alias cannot add history that its canonical record would not supply.
		if len(bindings[original.ReportID+":"+original.ConfigurationID]) == 0 {
			return nil
		}
		canonical, e := s.resolveObservation(rev, record.ID)
		if e != nil {
			return e
		}
		if seenRecords[canonical] {
			return nil
		}
		seenRecords[canonical] = true
		if canonical != record.ID {
			record, e = s.record(rev.Catalog, "result", canonical)
			if e != nil {
				return e
			}
		}
		var result wire.Result
		if e = json.Unmarshal(record.Data, &result); e != nil {
			return e
		}
		ids := bindings[result.ReportID+":"+result.ConfigurationID]
		if len(ids) == 0 {
			return nil
		}
		if e = s.enrichObservation(rev, record, &result); e != nil {
			return e
		}
		status, reason, e := s.SummaryEligibility(ctx, revision, result)
		if e != nil {
			return e
		}
		result.MeasurementMethod = nil
		result.Evidence = nil
		record.Data, e = wire.Encode(result)
		if e != nil {
			return e
		}
		raw, e := wire.Encode(historyReadRow{record, status, reason})
		if e != nil {
			return e
		}
		if e = put(historyReadKey("result", record.ID), raw); e != nil {
			return e
		}
		for _, id := range ids {
			value, closer, e := db.Get(historyReadKey("binding", id))
			if e != nil {
				return e
			}
			var context HistoryContext
			e = json.Unmarshal(value, &context)
			closer.Close()
			if e != nil {
				return e
			}
			dates := context.Binding.TargetDates
			if context.Binding.TargetDate != "" {
				dates = []string{context.Binding.TargetDate}
			}
			for _, date := range dates {
				key := historyReadKey("row", result.Metric, result.Scenario, result.Statistic, date, result.Profile, result.EnvironmentID, result.TrackID, result.Workload, record.ID, id)
				if e = put(key, []byte(record.ID)); e != nil {
					return e
				}
				postings++
			}
		}
		records++
		if records%5000 == 0 && progress != nil {
			progress("results", records)
		}
		return nil
	})
	if e != nil {
		return e
	}
	if e = batch.Commit(pebble.NoSync); e != nil {
		return e
	}
	if e = db.Set([]byte("complete"), []byte(historyReadVersion+":"+revision), pebble.Sync); e != nil {
		return e
	}
	if e = db.Close(); e != nil {
		return e
	}
	closed = true
	if progress != nil {
		progress("complete", postings)
	}
	// The caller prepares this directory while serving is stopped. A failed build
	// never replaces the complete index; interruption can restart .building.
	previous := directory + ".previous"
	if e = os.RemoveAll(previous); e != nil {
		return e
	}
	if _, e = os.Stat(directory); e == nil {
		if e = os.Rename(directory, previous); e != nil {
			return e
		}
	}
	if e = os.Rename(temporary, directory); e != nil {
		return e
	}
	return os.RemoveAll(previous)
}

type HistoryReadSelection struct {
	Rows        []wire.Record
	Bindings    []HistoryContext
	Eligibility map[string][2]string
	Scanned     int
}

// CaptureDates discovers eligible dates across the full scope, independently of
// the selected window. It stops reading each date after one valid observation.
func (h *HistoryReadIndex) CaptureDates(ctx context.Context, q Query, tracks []string) ([]string, error) {
	if q.Revision != h.Revision {
		return nil, ErrNotFound
	}
	prefix := historyReadKey("row", q.Metric, q.Scenario, q.Statistic)
	it, err := h.db.NewIter(&pebble.IterOptions{LowerBound: prefix, UpperBound: append(append([]byte{}, prefix...), 255)})
	if err != nil {
		return nil, err
	}
	defer it.Close()
	envs := map[string]bool{q.Environment: true}
	for _, id := range q.Environments {
		envs[id] = true
	}
	lanes := map[string]bool{}
	for _, id := range tracks {
		lanes[id] = true
	}
	dates := []string{}
	scanned := 0
	for valid := it.First(); valid; {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		scanned++
		if scanned > 500000 {
			return nil, ErrLimit
		}
		parts := strings.Split(string(it.Key()), "\x00")
		if len(parts) != 12 {
			return nil, fmt.Errorf("invalid history serving key")
		}
		if !envs[parts[6]] || !lanes[parts[7]] || q.Profile != "" && q.Profile != parts[5] || q.Workload != "" && q.Workload != parts[8] {
			valid = it.Next()
			continue
		}
		raw, closer, e := h.db.Get(historyReadKey("result", parts[9]))
		if e != nil {
			return nil, e
		}
		var row historyReadRow
		e = json.Unmarshal(raw, &row)
		closer.Close()
		if e != nil {
			return nil, e
		}
		if row.Status == "ok" {
			if _, ok := value(row.Record); ok {
				dates = append(dates, parts[4])
				valid = it.SeekGE(append(append([]byte{}, prefix...), []byte(parts[4]+"\x01")...))
				continue
			}
		}
		valid = it.Next()
	}
	return dates, it.Error()
}

func (h *HistoryReadIndex) Select(ctx context.Context, q Query, from, until string, tracks []string) (HistoryReadSelection, error) {
	output := HistoryReadSelection{Rows: []wire.Record{}, Bindings: []HistoryContext{}, Eligibility: map[string][2]string{}}
	if q.Revision != h.Revision {
		return output, ErrNotFound
	}
	prefix := historyReadKey("row", q.Metric, q.Scenario, q.Statistic)
	iterator, e := h.db.NewIter(&pebble.IterOptions{LowerBound: append(append([]byte{}, prefix...), []byte(from+"\x00")...), UpperBound: append(append([]byte{}, prefix...), []byte(until+"\x00")...)})
	if e != nil {
		return output, e
	}
	defer iterator.Close()
	environments := map[string]bool{q.Environment: true}
	if len(q.Environments) > 0 {
		environments = map[string]bool{}
		for _, id := range q.Environments {
			environments[id] = true
		}
	}
	lanes := map[string]bool{}
	for _, id := range tracks {
		lanes[id] = true
	}
	seen := map[string]bool{}
	contexts := map[string]bool{}
	order := map[string]uint64{}
	contextIDs := []string{}
	decoded := 0
	for valid := iterator.First(); valid; valid = iterator.Next() {
		if e = ctx.Err(); e != nil {
			return output, e
		}
		output.Scanned++
		if output.Scanned > 500000 {
			return output, ErrLimit
		}
		parts := strings.Split(string(iterator.Key()), "\x00")
		if len(parts) != 12 {
			return output, fmt.Errorf("invalid history serving key")
		}
		if !environments[parts[6]] || !lanes[parts[7]] || q.Profile != "" && parts[5] != q.Profile || q.Workload != "" && parts[8] != q.Workload {
			continue
		}
		id, binding := parts[9], parts[10]
		if !seen[id] {
			raw, closer, e := h.db.Get(historyReadKey("result", id))
			if e != nil {
				return output, e
			}
			decoded += len(raw)
			if decoded > 128<<20 {
				closer.Close()
				return output, ErrLimit
			}
			var row historyReadRow
			e = json.Unmarshal(raw, &row)
			closer.Close()
			if e != nil {
				return output, e
			}
			if row.Record.ID != id {
				return output, fmt.Errorf("history serving result differs")
			}
			output.Rows = append(output.Rows, row.Record)
			output.Eligibility[id] = [2]string{row.Status, row.Reason}
			seen[id] = true
		}
		if !contexts[binding] {
			raw, closer, e := h.db.Get(historyReadKey("binding", binding))
			if e != nil {
				return output, e
			}
			var context HistoryContext
			e = json.Unmarshal(raw, &context)
			closer.Close()
			if e != nil {
				return output, e
			}
			position, found := h.ordinals[binding]
			if !found {
				return output, fmt.Errorf("history binding order missing")
			}
			order[binding] = position
			contextIDs = append(contextIDs, binding)
			output.Bindings = append(output.Bindings, context)
			contexts[binding] = true
		}
	}
	if e = iterator.Error(); e != nil {
		return output, e
	}
	// Decode sort fields once instead of decoding each summary for every
	// comparison. This preserves the history ordering used by ResultsContext.
	if q.Sort == "value" || q.Sort == "-value" {
		sortResultRecords(output.Rows, q, true)
	} else {
		type sortFields struct {
			Created           time.Time
			Workload, Runtime string
		}
		keys := make(map[string]sortFields, len(output.Rows))
		for _, row := range output.Rows {
			var key sortFields
			if e = json.Unmarshal(row.Data, &key); e != nil {
				return output, e
			}
			keys[row.ID] = key
		}
		sort.Slice(output.Rows, func(i, j int) bool {
			a, b := keys[output.Rows[i].ID], keys[output.Rows[j].ID]
			if !a.Created.Equal(b.Created) {
				return a.Created.Before(b.Created)
			}
			if a.Workload != b.Workload {
				return a.Workload < b.Workload
			}
			if a.Runtime != b.Runtime {
				return a.Runtime < b.Runtime
			}
			return output.Rows[i].ID < output.Rows[j].ID
		})
	}
	// Binding ordinals were saved when the published jobs were traversed.
	// Sort those numbers directly; serializing and hashing a full alias list
	// for every comparison makes multi-engine windows unnecessarily expensive.
	type orderedBinding struct {
		Position uint64
		Context  HistoryContext
	}
	ordered := make([]orderedBinding, len(output.Bindings))
	for i, context := range output.Bindings {
		ordered[i] = orderedBinding{order[contextIDs[i]], context}
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Position < ordered[j].Position })
	for i, binding := range ordered {
		output.Bindings[i] = binding.Context
	}

	return output, nil
}
