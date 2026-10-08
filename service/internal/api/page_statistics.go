package api

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const TimingSamplePolicy = "current-host-timing-recorded-samples-v1"

type PageStatistics struct {
	TimingSamples      *uint64 `json:"timingSamples"`
	TimingSamplePolicy string  `json:"timingSamplePolicy"`
}

// Count producer-recorded samples across current host selections. Inner samples
// are not independent launches. Missing recorded counts stay unknown; they are
// never replaced with a launch count or a count of loaded table cells.
func (b *PageBuilder) Statistics(ctx context.Context, environments []wire.Record) (PageStatistics, error) {
	stats := PageStatistics{TimingSamplePolicy: TimingSamplePolicy}
	groups := map[string][]string{}
	exact := map[string]bool{}
	for _, record := range environments {
		var host struct {
			OS, Arch, Hostname string
			CPU                string `json:"cpu_description"`
		}
		if err := json.Unmarshal(record.Data, &host); err != nil {
			return stats, err
		}
		identity, _ := json.Marshal(host)
		key := string(identity)
		if host.OS == "" || host.Arch == "" || host.Hostname == "" || host.CPU == "" {
			key = record.ID
			exact[key] = true
		}
		groups[key] = append(groups[key], record.ID)
	}
	total := uint64(0)
	complete := true
	seen := map[string]bool{}
	for key, members := range groups {
		sort.Strings(members)
		for _, scenario := range []string{"compile", "instantiate", "first-call", "steady"} {
			membership := members
			if exact[key] {
				membership = nil
			}
			rows, err := b.api.resultRows(ctx, store.Query{Revision: b.Revision, Environment: members[0], Environments: membership, Selection: "current", Metric: "time.wall", Scenario: scenario, Profile: "timing", Statistic: "median_ns_per_operation", Sort: "catalog"}, false)
			if err != nil {
				return stats, err
			}
			for _, record := range rows {
				if seen[record.ID] {
					continue
				}
				seen[record.ID] = true
				var result wire.Result
				if err = json.Unmarshal(record.Data, &result); err != nil {
					return stats, err
				}
				var summary struct {
					RecordedSamples *uint64 `json:"recorded_samples"`
				}
				if err = json.Unmarshal(result.Summary, &summary); err != nil {
					return stats, err
				}
				if summary.RecordedSamples == nil {
					complete = false
					continue
				}
				if *summary.RecordedSamples > 9007199254740991-total {
					return stats, fmt.Errorf("sample count exceeds exact display range")
				}
				total += *summary.RecordedSamples
			}
		}
	}
	if complete {
		stats.TimingSamples = &total
	}
	return stats, nil
}
