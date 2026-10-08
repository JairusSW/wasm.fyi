package api

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Family counts are computed over producer probe records. Contracts and evidence
// remain separately paged and are never embedded in the compatibility bootstrap.
func (a *API) featureSummary(w http.ResponseWriter, r *http.Request, revision string, immutable bool) {
	p := r.URL.Query()
	anchor := p.Get("environment")
	if (p.Get("feature") == "") != (p.Get("configuration") == "") || p.Get("feature") != "" && (!wire.IsIdentity(p.Get("feature")) || !wire.IsHash(p.Get("configuration"))) {
		problem(w, r, wire.Invalid("selected feature details require exact feature and configuration"))
		return
	}
	if !wire.IsHash(anchor) {
		problem(w, r, wire.Invalid("feature summary requires environment"))
		return
	}
	environments := []string{}
	if p.Has("environments") {
		if err := wire.Decode([]byte(p.Get("environments")), &environments); err != nil {
			problem(w, r, err)
			return
		}
	}
	ids, err := a.Store.NormalizeHostEnvironments(revision, anchor, environments)
	if err != nil {
		problem(w, r, err)
		return
	}
	if len(ids) == 0 {
		ids = []string{anchor}
	}
	hosts := map[string]bool{}
	for _, id := range ids {
		hosts[id] = true
	}
	type contract struct {
		Workload string   `json:"workload"`
		Status   string   `json:"status"`
		Scope    string   `json:"scope"`
		Report   string   `json:"report"`
		Probe    string   `json:"probe"`
		Reasons  []string `json:"reasons"`
	}
	type family struct {
		ID           string     `json:"id"`
		Total        int        `json:"total"`
		Pass         int        `json:"pass"`
		Failed       int        `json:"failed"`
		Unsupported  int        `json:"unsupported"`
		CompiledOnly int        `json:"compiledOnly"`
		Executed     int        `json:"executed"`
		Reports      []string   `json:"reports"`
		Reasons      []string   `json:"reasons"`
		Contracts    []contract `json:"contracts"`
	}
	type version struct {
		ID          string            `json:"id"`
		Identity    string            `json:"identity"`
		Channel     string            `json:"channel"`
		Version     string            `json:"version"`
		Source      string            `json:"source"`
		Revision    *string           `json:"revision"`
		CollectedAt time.Time         `json:"collectedAt"`
		Description map[string]string `json:"description"`
		Features    []family          `json:"features"`
	}
	selected := map[string]wire.Record{}
	dates := map[string]time.Time{}
	decoded := 0
	for offset := 0; ; {
		page, err := a.Store.CatalogPage(r.Context(), revision, "feature-probe", offset, 100)
		if err != nil {
			problem(w, r, err)
			return
		}
		if page.Total > 10000 {
			problem(w, r, store.ErrLimit)
			return
		}
		for _, record := range page.Items {
			decoded += len(record.Data)
			if decoded > 32<<20 {
				problem(w, r, store.ErrLimit)
				return
			}
			probe, err := wire.FeatureProbeData(record.Data)
			if err != nil {
				problem(w, r, err)
				return
			}
			if !hosts[probe.EnvironmentID] {
				continue
			}
			key := probe.ConfigurationID + ":" + probe.Workload
			old, ok := selected[key]
			if !ok || probe.Created.After(dates[key]) || probe.Created.Equal(dates[key]) && record.ID > old.ID {
				selected[key] = record
				dates[key] = probe.Created
			}
		}
		if page.Next >= page.Total {
			break
		}
		offset = page.Next
	}
	versions := map[string]*version{}
	families := map[string]map[string]*family{}
	for _, record := range selected {
		probe, _ := wire.FeatureProbeData(record.Data)
		workload, err := a.Store.Record(revision, "workload", probe.ContractID)
		if err != nil {
			problem(w, r, err)
			return
		}
		var metadata struct{ Provenance struct{ Baseline bool } }
		_ = json.Unmarshal(workload.Data, &metadata)
		if metadata.Provenance.Baseline {
			continue
		}
		configuration, err := a.Store.Record(revision, "configuration", probe.ConfigurationID)
		if err != nil {
			problem(w, r, err)
			return
		}
		facts, err := configurationSummary(configuration)
		if err != nil {
			problem(w, r, err)
			return
		}
		var cfg struct {
			ID, Version, Backend string
			Description          struct {
				Runtime string `json:"runtime"`
				Version string `json:"runtime_version"`
				Backend string `json:"backend"`
			}
		}
		_ = json.Unmarshal(facts.Data, &cfg)
		if cfg.Version == "" {
			cfg.Version = cfg.Description.Version
		}
		if cfg.Backend == "" {
			cfg.Backend = cfg.Description.Backend
		}
		current := versions[probe.ConfigurationID]
		if current == nil {
			channel := "development"
			label := strings.TrimPrefix(cfg.Version, "v")
			if len(label) > 0 && label[0] >= '0' && label[0] <= '9' && strings.Contains(label, ".") && !strings.Contains(label, "nightly") {
				channel = "stable"
			}
			current = &version{ID: probe.Runtime, Identity: probe.ConfigurationID, Channel: channel, Version: cfg.Version, Source: "/api/v1/configurations/" + probe.ConfigurationID + "?revision=" + revision, CollectedAt: probe.Created, Description: map[string]string{"runtime": probe.Runtime, "runtime_version": cfg.Version, "backend": cfg.Backend}, Features: []family{}}
			versions[probe.ConfigurationID] = current
			families[probe.ConfigurationID] = map[string]*family{}
		}
		if probe.Created.After(current.CollectedAt) {
			current.CollectedAt = probe.Created
		}
		f := families[probe.ConfigurationID][probe.Feature]
		if f == nil {
			f = &family{ID: probe.Feature, Reports: []string{}, Reasons: []string{}, Contracts: []contract{}}
			families[probe.ConfigurationID][probe.Feature] = f
		}
		outcomes := map[string]int{}
		scenarios := []string{}
		for _, scenario := range probe.Scenarios {
			scenarios = append(scenarios, scenario.Scenario)
			for status, count := range scenario.Outcomes {
				outcomes[status] += count
			}
		}
		status := "unavailable"
		if outcomes["failed"]+outcomes["crashed"]+outcomes["timeout"] > 0 {
			status = "failed"
			f.Failed++
		} else if outcomes["ok"] > 0 {
			status = "passed"
			f.Pass++
		} else if outcomes["unsupported"] > 0 {
			status = "unsupported"
			f.Unsupported++
		}
		f.Total++
		scope := "compile-only"
		for _, scenario := range scenarios {
			if scenario == "steady" || scenario == "first-call" {
				scope = "execution"
				break
			}
			if scenario == "instantiate" {
				scope = "compile-and-instantiate"
			}
		}
		if scope == "execution" {
			f.Executed++
		} else {
			f.CompiledOnly++
		}
		present := false
		for _, id := range f.Reports {
			present = present || id == probe.ReportID
		}
		if !present {
			f.Reports = append(f.Reports, probe.ReportID)
		}
		if p.Get("configuration") == probe.ConfigurationID && p.Get("feature") == probe.Feature {
			f.Contracts = append(f.Contracts, contract{probe.Workload, status, scope, probe.ReportID, record.ID, []string{}})
		}
	}
	output := []version{}
	for id, v := range versions {
		for _, f := range families[id] {
			sort.Slice(f.Contracts, func(i, j int) bool { return f.Contracts[i].Workload < f.Contracts[j].Workload })
			if len(f.Contracts) > 100 {
				problem(w, r, store.ErrLimit)
				return
			}
			v.Features = append(v.Features, *f)
		}
		sort.Slice(v.Features, func(i, j int) bool { return v.Features[i].ID < v.Features[j].ID })
		output = append(output, *v)
	}
	sort.Slice(output, func(i, j int) bool { return output[i].CollectedAt.After(output[j].CollectedAt) })
	if len(output) > 64 {
		problem(w, r, store.ErrLimit)
		return
	}
	respond(w, r, 200, map[string]any{"revision": revision, "items": output, "policy": "recorded-feature-trials-v1", "selectionPolicy": "latest-per-exact-configuration-workload-v1"}, immutable)
}
