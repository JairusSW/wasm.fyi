package store

import (
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Read interpretation only for reports in the requested measurement scope.
// Publication summaries prune unrelated jobs before their manifests are read.
func (s *Store) ScopedHistoryBindings(ctx context.Context, revision string, reports map[string]bool) ([]HistoryContext, error) {
	rev, err := s.Revision(revision)
	if err != nil {
		return nil, err
	}
	set, err := s.indexGet(rev.Indexes, indexKey("published-job", "", ""))
	if err != nil {
		return nil, err
	}
	output := []HistoryContext{}
	budget := ScanLimit
	decoded := 0
	err = s.walk(set.Root, &budget, func(key, id string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		var summary PublishedJob
		if err := s.load(id, &summary); err != nil {
			return err
		}
		if summary.HistoryBindings == 0 {
			return nil
		}
		found := false
		for _, report := range summary.Reports {
			found = found || reports[report]
		}
		if !found {
			return nil
		}
		data, err := s.jobContent(summary.ID)
		if err != nil {
			return err
		}
		decoded += len(data)
		if decoded > 32<<20 {
			return ErrLimit
		}
		var job wire.Job
		if err = json.Unmarshal(data, &job); err != nil {
			return err
		}
		for _, binding := range job.History {
			if !reports[binding.ReportID] {
				continue
			}
			record, err := s.Record(revision, "report", binding.ReportID)
			if err != nil {
				return err
			}
			created, err := historyReportCreated(record.Data)
			if err != nil {
				return err
			}
			output = append(output, HistoryContext{Binding: binding, CollectedAt: created, PublishedAt: summary.PublishedAt, CollectionTimeSource: "source-report-created", InterpretationSource: "trusted-publisher-assertion"})
			if len(output) > 10000 {
				return ErrLimit
			}
		}
		return nil
	})
	return output, err
}
