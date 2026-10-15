package sqldb

import (
	"strings"
)

func tableEngine(engine string) string {
	if !strings.HasPrefix(engine, "wago-") {
		return engine
	}
	local := engine == "wago-main-snapshot" || engine == "wago-arm64-branch"
	if strings.HasPrefix(engine, "wago-pr") {
		suffix := strings.TrimPrefix(engine, "wago-pr")
		local = suffix != ""
		for _, c := range suffix {
			if c < '0' || c > '9' {
				local = false
				break
			}
		}
	}
	if local {
		return engine
	}
	return "wago"
}

// Match the frontend's pinned latest-version selection independently for feature
// and application corpora. Failed fallback labels share their pinned source key.
func activeTableCells(cells []Cell) []Cell {
	configs := map[string]*aggregateConfiguration{}
	chosen := map[string]*aggregateConfiguration{}
	keys := make([]string, len(cells))
	groups := make([]string, len(cells))
	for i, cell := range cells {
		row := cell.Result
		row.Engine = tableEngine(row.Engine)
		group := row.Engine
		if strings.HasPrefix(row.Workload, "features/") {
			group = "features/" + group
		}
		key := configKey(row)
		clock := row.CapturedAt
		if row.Source != nil {
			clock = row.Source.AsOf
		}
		cfg := configs[group+"\x00"+key]
		if cfg == nil {
			cfg = &aggregateConfiguration{key: key, clock: clock, qualified: qualified(row.Source)}
			configs[group+"\x00"+key] = cfg
		} else if later(clock, cfg.clock) {
			cfg.clock = clock
		}
		keys[i] = key
		groups[i] = group
	}
	for i, key := range keys {
		cfg := configs[groups[i]+"\x00"+key]
		old := chosen[groups[i]]
		if old == nil || cfg.qualified && !old.qualified || cfg.qualified == old.qualified && (later(cfg.clock, old.clock) || !later(cfg.clock, old.clock) && !later(old.clock, cfg.clock) && cfg.key < old.key) {
			chosen[groups[i]] = cfg
		}
	}
	selected := make([]Cell, 0, len(cells))
	corrected := map[string]bool{}
	hasCorrected := map[string]bool{}
	for i, cell := range cells {
		if keys[i] != chosen[groups[i]].key {
			continue
		}
		selected = append(selected, cell)
		if tableEngine(cell.Engine) == "v8" && cell.Backend == "turboshaft" {
			hasCorrected[groups[i]] = true
			corrected[cell.Workload+"|"+cell.Phase] = true
		}
	}
	if len(hasCorrected) == 0 {
		return selected
	}
	out := selected[:0]
	for _, cell := range selected {
		group := "v8"
		if strings.HasPrefix(cell.Workload, "features/") {
			group = "features/v8"
		}
		if !hasCorrected[group] || tableEngine(cell.Engine) != "v8" || cell.Backend == "turboshaft" || cell.Backend != "optimizing-only" && !corrected[cell.Workload+"|"+cell.Phase] {
			out = append(out, cell)
		}
	}
	return out
}
