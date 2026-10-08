package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

type RetainedHistoryRow struct {
	Runtime    string               `json:"runtime"`
	Date       string               `json:"date"`
	Role       string               `json:"role"`
	Revision   string               `json:"revision,omitempty"`
	SourceDate *time.Time           `json:"sourceDate,omitempty"`
	Release    *wire.HistoryRelease `json:"release,omitempty"`
}
type RetainedHistoryReport struct {
	ReportID string               `json:"reportId"`
	Rows     []RetainedHistoryRow `json:"rows"`
}

// CorrectRetainedHistory republishes only publisher interpretation of already
// accepted exports. It is restricted to the offline migration owner; scientific
// catalogs, observation identities and current/previous selections are reused.
// Original jobs and revisions remain immutable and independently addressable.
func (s *Store) CorrectRetainedHistory(ctx context.Context, sourceID string, wanted []RetainedHistoryReport) (string, error) {
	s.publish.Lock()
	defer s.publish.Unlock()
	if !s.offline {
		return "", fmt.Errorf("history correction requires offline migration mode")
	}
	if s.poisoned.Load() {
		return "", ErrNeedsRestart
	}
	parent := s.Current()
	old, err := s.Revision(parent)
	if err != nil {
		return "", err
	}
	if _, err = s.publishedSummary(old, sourceID); err != nil {
		return "", err
	}
	original, err := s.Job(sourceID)
	if err != nil {
		return "", err
	}
	if original.Kind != "retained-history" && original.Kind != "retained-measurement" {
		return "", wire.Invalid("correction source is not retained history")
	}
	reader := s.queryStore()
	requested := map[string][]RetainedHistoryRow{}
	for _, r := range wanted {
		if len(r.Rows) == 0 || requested[r.ReportID] != nil {
			return "", wire.Invalid("empty or duplicate correction report")
		}
		requested[r.ReportID] = r.Rows
	}
	corrected := original
	corrected.Kind = "retained-history"
	corrected.History = nil
	for _, binding := range original.History {
		if requested[binding.ReportID] == nil {
			corrected.History = append(corrected.History, binding)
		}
	}
	found := map[string]bool{}
	for _, export := range original.Exports {
		reportID := export.Manifest.ReportID
		rows := requested[reportID]
		if len(rows) == 0 {
			continue
		}
		found[reportID] = true
		configurations := map[string]string{}
		for _, row := range rows {
			configurations[row.Runtime] = ""
		}
		objects, err := reader.manifestObjectsContext(ctx, export.Manifest, false)
		if err != nil {
			return "", err
		}
		for _, object := range objects {
			if err = ctx.Err(); err != nil {
				return "", err
			}
			if object.Kind != "record" {
				continue
			}
			var record wire.Record
			if err = reader.load(object.SHA256, &record); err != nil {
				return "", err
			}
			if record.Kind != "result" {
				continue
			}
			var result wire.Result
			if err = json.Unmarshal(record.Data, &result); err != nil {
				return "", err
			}
			if _, ok := configurations[result.Runtime]; ok && result.ReportID == reportID {
				previous := configurations[result.Runtime]
				if previous != "" && previous != result.ConfigurationID {
					return "", wire.Invalid("ambiguous historical runtime configuration")
				}
				configurations[result.Runtime] = result.ConfigurationID
			}
		}
		grouped := map[string]*wire.HistoryBinding{}
		for _, row := range rows {
			config := configurations[row.Runtime]
			if config == "" {
				return "", wire.Invalid("history runtime absent from accepted export")
			}
			binding := wire.HistoryBinding{ReportID: reportID, ConfigurationID: config, Policy: wire.HistoryBindingPolicy, SourceDate: row.SourceDate, SourceRevision: row.Revision, BuildRole: row.Role, Release: row.Release}
			raw, _ := wire.Encode(binding)
			key := string(raw)
			if grouped[key] == nil {
				copy := binding
				copy.TargetDates = []string{}
				grouped[key] = &copy
			}
			dates := grouped[key].TargetDates
			already := false
			for _, date := range dates {
				already = already || date == row.Date
			}
			if !already {
				grouped[key].TargetDates = append(dates, row.Date)
			}
		}
		keys := []string{}
		for key := range grouped {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			binding := grouped[key]
			sort.Strings(binding.TargetDates)
			corrected.History = append(corrected.History, *binding)
		}
	}
	for id := range requested {
		if !found[id] {
			return "", wire.Invalid("correction references foreign report")
		}
	}
	raw, _ := wire.Encode(struct {
		Source  string
		History []wire.HistoryBinding
	}{sourceID, corrected.History})
	plan := wire.Hash(raw)
	corrected.Session = "history-correction-" + plan[:32]
	corrected.Plan = plan
	corrected.Corpus = "bindings"
	corrected.Attempt = plan
	if err = corrected.Validate(); err != nil {
		return "", err
	}
	body, err := wire.Encode(corrected)
	if err != nil {
		return "", err
	}
	if len(body) > wire.JobBytes {
		return "", ErrLimit
	}
	id := wire.Hash(body)
	if accepted, e := s.get(key("accepted", id)); e == nil {
		return string(accepted), nil
	} else if e != pebble.ErrNotFound {
		return "", e
	}
	if err = s.installRepresentation(id, body, wire.JobBytes); err != nil {
		return "", err
	}
	rev := old
	rev.Parent = parent
	rev.Job = id
	rev.Created = time.Now().UTC()
	rev.Publisher = s.publisher
	rev.SourceVerification = "publisher-asserted-metadata"
	rev.Qualification = "not-checked"
	if err = s.indexPublishedJobs(ctx, &rev, corrected); err != nil {
		return "", err
	}
	revID, err := s.put(rev)
	if err != nil {
		return "", err
	}
	if err = s.checkpoint("indexes"); err != nil {
		return "", err
	}
	rb, err := wire.Encode(rev)
	if err != nil {
		return "", err
	}
	batch := s.db.NewBatch()
	defer batch.Close()
	for _, pair := range []struct{ k, v []byte }{{key("import", id), body}, {key("revision", revID), rb}, {key("accepted", id), []byte(revID)}, {key("current"), []byte(revID)}} {
		if err = batch.Set(pair.k, pair.v, nil); err != nil {
			return "", err
		}
	}
	if err = s.checkpoint("before-commit"); err != nil {
		return "", err
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	if err = s.flushOffline(revID, s.overviews, s.registrationRoot()); err != nil {
		return "", err
	}
	if err = batch.Commit(pebble.Sync); err != nil {
		s.poisoned.Store(true)
		return "", err
	}
	if err = s.checkpoint("after-commit"); err != nil {
		s.poisoned.Store(true)
		return "", err
	}
	if err = s.portableRoots(revID, s.registrationRoot(), s.overviews); err != nil {
		s.poisoned.Store(true)
		return "", err
	}
	s.mu.Lock()
	rev.ordinal = len(s.published) + 1
	s.published[revID] = rev
	s.current = revID
	s.mu.Unlock()
	return revID, nil
}
