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

// Match the frontend's latest-available selection independently for feature and
// application corpora: the newest pinned version per engine, with each cell it
// has not measured yet taken from the most recent earlier version. Failed
// fallback labels share their pinned source key.
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
	// Each cell comes from the engine's chosen configuration, or, until that
	// configuration has measured it, from the most preferred earlier one.
	best := map[string]int{}
	for i, cell := range cells {
		slot := groups[i] + "\x00" + cell.Workload + "\x00" + cell.Phase
		j, ok := best[slot]
		if !ok {
			best[slot] = i
			continue
		}
		a, b := configs[groups[i]+"\x00"+keys[i]], configs[groups[j]+"\x00"+keys[j]]
		top := chosen[groups[i]]
		if a == b {
			if later(cell.CapturedAt, cells[j].CapturedAt) || cell.Backend == "turboshaft" && cells[j].Backend != "turboshaft" && !later(cells[j].CapturedAt, cell.CapturedAt) {
				best[slot] = i
			}
		} else if a == top || b != top && (a.qualified && !b.qualified || a.qualified == b.qualified && (later(a.clock, b.clock) || !later(b.clock, a.clock) && a.key < b.key)) {
			best[slot] = i
		}
	}
	selected := make([]Cell, 0, len(cells))
	corrected := map[string]bool{}
	hasCorrected := map[string]bool{}
	for i, cell := range cells {
		if best[groups[i]+"\x00"+cell.Workload+"\x00"+cell.Phase] != i {
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
