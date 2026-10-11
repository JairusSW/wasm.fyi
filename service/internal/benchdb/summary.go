package benchdb

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/cockroachdb/pebble/v2"
)

type PlatformSummary struct {
	PlatformChoice
	Revision            string `json:"revision,omitempty"`
	LatestRevision      string `json:"latestRevision,omitempty"`
	HistoryRevision     string `json:"historyRevision,omitempty"`
	LatestTimingSamples int64  `json:"latestTimingSamples"`
	AllTimingSamples    int64  `json:"allTimingSamples"`
	LatestRows          int    `json:"latestRows"`
	HistoryRows         int    `json:"historyRows"`
	CapturedAt          string `json:"capturedAt,omitempty"`
	ImportedAt          string `json:"importedAt,omitempty"`
}

type Summary struct {
	Revision  string            `json:"revision"`
	Platforms []PlatformSummary `json:"platforms"`
}

// Summary reads materialized metadata and counters, never measurement pages.
func (s *Store) Summary(ctx context.Context) (Summary, error) {
	out := Summary{Platforms: []PlatformSummary{}}
	snapshot := s.db.NewSnapshot()
	defer snapshot.Close()
	revision, err := get(snapshot, "meta/revision")
	if err != nil {
		return out, err
	}
	out.Revision = string(revision)
	iter, err := snapshot.NewIter(&pebble.IterOptions{LowerBound: []byte("platforms/"), UpperBound: prefixEnd("platforms/")})
	if err != nil {
		return out, err
	}
	defer iter.Close()
	for iter.First(); iter.Valid(); iter.Next() {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		id := strings.TrimPrefix(string(iter.Key()), "platforms/")
		var platform Platform
		if err = json.Unmarshal(iter.Value(), &platform); err != nil {
			return out, err
		}
		item := PlatformSummary{PlatformChoice: PlatformChoice{id, platform}}
		for _, phase := range []string{"compile", "instantiate", "first-call", "steady"} {
			current, err := count(snapshot, "count/"+id+"/"+phase)
			if err != nil {
				return out, err
			}
			item.LatestRows += current
			history, err := count(snapshot, "historycount/"+id+"/"+phase)
			if err != nil {
				return out, err
			}
			item.HistoryRows += history
		}
		for _, field := range []struct {
			key   string
			value *string
		}{{"captured", &item.CapturedAt}, {"imported", &item.ImportedAt}} {
			value, err := get(snapshot, "prepared/"+field.key+"/"+id)
			if err == nil {
				*field.value = string(value)
			} else if !errors.Is(err, pebble.ErrNotFound) {
				return out, err
			}
		}
		out.Platforms = append(out.Platforms, item)
	}
	return out, iter.Error()
}

func prepareCaptureTime(batch *pebble.Batch, platform, stamp string) error {
	key := "prepared/captured/" + platform
	previous, err := get(batch, key)
	if err != nil && !errors.Is(err, pebble.ErrNotFound) {
		return err
	}
	if len(previous) == 0 || later(stamp, string(previous)) {
		return batch.Set([]byte(key), []byte(stamp), nil)
	}
	return nil
}
