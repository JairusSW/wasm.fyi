package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type HistoryContext struct {
	Binding              wire.HistoryBinding `json:"binding"`
	CollectedAt          *time.Time          `json:"collectedAt"`
	PublishedAt          time.Time           `json:"publishedAt"`
	CollectionTimeSource string              `json:"collectionTimeSource"`
	InterpretationSource string              `json:"interpretationSource"`
}

func historyReportCreated(data []byte) (*time.Time, error) {
	var source struct {
		Created *time.Time `json:"created"`
	}
	if e := json.Unmarshal(data, &source); e != nil {
		return nil, wire.Invalid("invalid history report collection time")
	}
	if source.Created != nil && (source.Created.IsZero() || source.Created.Year() < 1 || source.Created.Year() > 9999) {
		return nil, wire.Invalid("invalid history report collection time")
	}
	return source.Created, nil
}

func (s *Store) validateHistoryBindings(ctx context.Context, j wire.Job, records map[string]wire.Record) error {
	wanted := map[string]bool{}
	for _, h := range j.History {
		wanted[h.ReportID+":"+h.ConfigurationID] = true
		report, ok := records["report:"+h.ReportID]
		if !ok {
			return wire.Invalid("history report descriptor missing")
		}
		if _, e := historyReportCreated(report.Data); e != nil {
			return e
		}
	}
	if len(wanted) == 0 {
		return nil
	}
	for _, r := range records {
		if e := ctx.Err(); e != nil {
			return e
		}
		if r.Kind != "result" {
			continue
		}
		var v wire.Result
		if e := wire.Decode(r.Data, &v); e != nil {
			return e
		}
		key := v.ReportID + ":" + v.ConfigurationID
		if _, ok := wanted[key]; ok {
			wanted[key] = false
		}
	}
	for _, missing := range wanted {
		if missing {
			return wire.Invalid("history binding lacks an exported measurement configuration")
		}
	}
	return nil
}

// Publication membership is checked before exposing any interpretation, including
// direct IDs. This uses the existing job index and introduces no chain scan.
func (s *Store) HistoryContexts(ctx context.Context, revision, id string, offset, limit int) ([]HistoryContext, int, error) {
	if offset < 0 || limit < 1 || limit > 100 {
		return nil, 0, wire.Invalid("invalid history context page")
	}
	job, e := s.PublishedArchive(ctx, revision, id)
	if e != nil {
		return nil, 0, e
	}
	if len(job.History) == 0 {
		if offset != 0 {
			return nil, 0, wire.Invalid("history context offset exceeds total")
		}
		return []HistoryContext{}, 0, nil
	}
	rev, e := s.Revision(revision)
	if e != nil {
		return nil, 0, e
	}
	set, e := s.indexGet(rev.Indexes, indexKey("published-job", "", ""))
	if e != nil {
		return nil, 0, e
	}
	digest, e := s.mapGet(set.Root, id)
	if e != nil {
		return nil, 0, e
	}
	if digest == "" {
		return nil, 0, ErrNotFound
	}
	var summary PublishedJob
	if e = s.load(digest, &summary); e != nil {
		return nil, 0, e
	}
	if summary.ID != id {
		return nil, 0, wire.Invalid("history publication differs")
	}
	total := len(job.History)
	if offset > total {
		return nil, total, wire.Invalid("history context offset exceeds total")
	}
	end := offset + limit
	if end > total {
		end = total
	}
	out := make([]HistoryContext, 0, end-offset)
	for _, binding := range job.History[offset:end] {
		if e = ctx.Err(); e != nil {
			return nil, 0, e
		}
		report, e := s.Record(revision, "report", binding.ReportID)
		if e != nil {
			return nil, 0, e
		}
		collected, e := historyReportCreated(report.Data)
		if e != nil {
			return nil, 0, e
		}
		if _, e = s.Record(revision, "configuration", binding.ConfigurationID); e != nil {
			return nil, 0, e
		}
		out = append(out, HistoryContext{Binding: binding, CollectedAt: collected, PublishedAt: summary.PublishedAt, CollectionTimeSource: "source-report-created", InterpretationSource: "trusted-publisher-assertion"})
	}
	return out, total, nil
}
