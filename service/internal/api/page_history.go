package api

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Prepare complete current populations for each UI metric and physical
// host. This is server-side query preparation, never browser bootstrap data.
func (b *PageBuilder) PrepareHistoryReferences(ctx context.Context, directory string, environments []wire.Record, progress func(int, int)) error {
	groups := map[string][]string{}
	exact := map[string]bool{}
	for _, record := range environments {
		var host struct {
			OS, Arch, Hostname string
			CPU                string `json:"cpu_description"`
		}
		if err := json.Unmarshal(record.Data, &host); err != nil {
			return err
		}
		raw, _ := json.Marshal(host)
		key := string(raw)
		if host.OS == "" || host.Arch == "" || host.Hostname == "" || host.CPU == "" {
			key = record.ID
			exact[key] = true
		}
		groups[key] = append(groups[key], record.ID)
	}
	groupKeys := []string{}
	for key := range groups {
		groupKeys = append(groupKeys, key)
	}
	sort.Strings(groupKeys)
	definitions := [][4]string{
		{"time.wall", "steady", "timing", "median_ns_per_operation"},
		{"time.wall", "compile", "timing", "median_ns_per_operation"},
		{"time.wall", "instantiate", "timing", "median_ns_per_operation"},
		{"time.wall", "first-call", "timing", "median_ns_per_operation"},
		{"process.peak_rss", "", "", "median_bytes"},
		{"process.rss", "", "", "median_bytes"},
		{"native.code_size", "compile", "", "size_bytes"},
	}
	queries := []store.Query{}
	for _, key := range groupKeys {
		members := groups[key]
		sort.Strings(members)
		membership := members
		if exact[key] {
			membership = nil
		}
		for _, d := range definitions {
			queries = append(queries, store.Query{Revision: b.Revision, Environment: members[0], Environments: membership, Selection: "current", Metric: d[0], Scenario: d[1], Profile: d[2], Statistic: d[3], Sort: "catalog"})
		}
	}
	return b.api.Store.PrepareHistoryReferences(ctx, directory, queries, progress)
}
