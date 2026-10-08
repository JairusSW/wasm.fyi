package store

import (
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"sort"
)

const HostSelectionVersion = "explicit-host-local-v1"

// Membership establishes a display host, not equivalent collection conditions.
// Each result retains its actual environment, kernel facts and collection policy.
func (s *Store) NormalizeHostEnvironments(revision, anchor string, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if len(ids) > 16 {
		return nil, wire.Invalid("host environment membership exceeds ceiling")
	}
	ids = append([]string{}, ids...)
	sort.Strings(ids)
	type host struct {
		OS, Arch, Hostname string
		CPU                string `json:"cpu_description"`
	}
	var identity host
	found := false
	for i, id := range ids {
		if !wire.IsHash(id) || (i > 0 && id == ids[i-1]) {
			return nil, wire.Invalid("invalid host environment membership")
		}
		record, err := s.Record(revision, "environment", id)
		if err != nil {
			return nil, err
		}
		var value host
		if err = json.Unmarshal(record.Data, &value); err != nil {
			return nil, err
		}
		if value.OS == "" || value.Arch == "" || value.Hostname == "" || value.CPU == "" {
			return nil, wire.Invalid("host environment identity is incomplete")
		}
		if i == 0 {
			identity = value
		} else if value != identity {
			return nil, wire.Invalid("environment membership crosses physical host identities")
		}
		found = found || id == anchor
	}
	if !found {
		return nil, wire.Invalid("anchor environment is absent from host membership")
	}
	return ids, nil
}

func (s *Store) hostResultsContext(ctx context.Context, q Query, historical bool) ([]wire.Record, error) {
	ids, err := s.NormalizeHostEnvironments(q.Revision, q.Environment, q.Environments)
	if err != nil {
		return nil, err
	}
	if !historical && q.Selection != "" && q.Selection != "current" && q.Selection != "previous" && q.Selection != "s1" && q.Selection != "s2" {
		return nil, wire.Invalid("invalid host selection")
	}
	type item struct {
		record wire.Record
		value  wire.Result
	}
	cells := map[string][]item{}
	seen := map[string]bool{}
	out := []wire.Record{}
	bytes := 0
	index := 0
	if q.Selection == "previous" || q.Selection == "s2" {
		index = 1
	}
	keep := index + 1
	newer := func(a, b item) bool {
		if !a.value.Created.Equal(b.value.Created) {
			return a.value.Created.After(b.value.Created)
		}
		return a.record.ID > b.record.ID
	}
	for _, environment := range ids {
		child := q
		child.Environments = nil
		child.Environment = environment
		if !historical {
			child.Method = ""
		}
		selections := []string{"current", "previous"}
		if historical {
			selections = []string{"current"}
		}
		for _, selection := range selections {
			child.Selection = selection
			rows, err := s.ResultsContext(ctx, child, historical)
			if err != nil {
				return nil, err
			}
			for _, record := range rows {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				if seen[record.ID] {
					continue
				}
				seen[record.ID] = true
				if len(seen) > ScanLimit {
					return nil, ErrLimit
				}
				if historical {
					bytes += len(record.Data)
					if bytes > 32<<20 {
						return nil, ErrLimit
					}
					out = append(out, record)
					continue
				}
				var value wire.Result
				if err = json.Unmarshal(record.Data, &value); err != nil {
					return nil, err
				}
				key, _ := json.Marshal([]string{value.TrackID, value.ContractID, value.Scenario, value.Profile, value.MetricDefinitionID, value.Statistic})
				candidates := append(cells[string(key)], item{record, value})
				bytes += len(record.Data)
				sort.Slice(candidates, func(i, j int) bool { return newer(candidates[i], candidates[j]) })
				if len(candidates) > keep {
					bytes -= len(candidates[keep].record.Data)
					candidates[keep] = item{}
					candidates = candidates[:keep]
				}
				cells[string(key)] = candidates
				// Retain only the observations needed by the selection policy.
				// A previous query needs two, while its returned set remains 32 MiB.
				if bytes > keep*(32<<20) {
					return nil, ErrLimit
				}
			}
		}
	}
	if !historical {
		outputBytes := 0
		for _, candidates := range cells {
			if len(candidates) > index {
				if q.Method == "" || candidates[index].value.MeasurementMethodID == q.Method {
					outputBytes += len(candidates[index].record.Data)
					if outputBytes > 32<<20 {
						return nil, ErrLimit
					}
					out = append(out, candidates[index].record)
				}
			}
		}
	}
	sortResultRecords(out, q, historical)
	return out, nil
}
