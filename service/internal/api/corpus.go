package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// One selected workload's summaries and references. Observations, native bytes
// and function indexes remain separate paginated resources.
func (a *API) corpus(w http.ResponseWriter, r *http.Request, revision string, immutable bool) {
	p := r.URL.Query()
	q := store.Query{Revision: revision, Environment: p.Get("environment"), Selection: p.Get("selection"), Workload: p.Get("workload"), Sort: "catalog"}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	inspecting := len(parts) >= 3 && parts[2] == "inspect"
	if inspecting {
		q.Metric = "native.code_size"
	}
	var contract *wire.Record
	if len(parts) == 4 {
		if !wire.IsHash(parts[3]) {
			problem(w, r, wire.Invalid("invalid workload contract"))
			return
		}
		record, e := a.Store.Record(revision, "workload", parts[3])
		if e != nil {
			problem(w, r, e)
			return
		}
		contract = &record
		q.Contract = record.ID
		var d struct{ ID string }
		if e = json.Unmarshal(record.Data, &d); e != nil {
			problem(w, r, e)
			return
		}
		q.Workload = d.ID
	}
	if !wire.IsHash(q.Environment) || q.Workload == "" || len(q.Workload) > 256 {
		problem(w, r, wire.Invalid("corpus requires a selected environment and workload"))
		return
	}
	if q.Selection == "" || q.Selection == "s1" {
		q.Selection = "current"
	}
	if q.Selection == "s2" {
		q.Selection = "previous"
	}
	if q.Selection != "current" && q.Selection != "previous" {
		problem(w, r, wire.Invalid("invalid corpus selection"))
		return
	}
	if p.Has("environments") {
		if e := wire.Decode([]byte(p.Get("environments")), &q.Environments); e != nil || len(q.Environments) == 0 {
			problem(w, r, wire.Invalid("invalid corpus host membership"))
			return
		}
	}
	var err error
	q.Environments, err = a.Store.NormalizeHostEnvironments(revision, q.Environment, q.Environments)
	if err != nil {
		problem(w, r, err)
		return
	}
	var laneIDs []string
	if err = wire.Decode([]byte(p.Get("tracks")), &laneIDs); err != nil || len(laneIDs) == 0 || len(laneIDs) > 32 {
		problem(w, r, wire.Invalid("corpus requires explicit tracks"))
		return
	}
	lanes := map[string]bool{}
	for _, id := range laneIDs {
		if !wire.IsHash(id) || lanes[id] {
			problem(w, r, wire.Invalid("invalid corpus tracks"))
			return
		}
		if _, err = a.Store.Record(revision, "track", id); err != nil {
			problem(w, r, err)
			return
		}
		lanes[id] = true
	}
	rows, err := a.resultRows(r.Context(), q, false)
	if err != nil {
		problem(w, r, err)
		return
	}
	selected := []wire.Record{}
	eligibility := map[string]matrixEligibility{}
	configs := map[string]wire.Record{}
	contracts := map[string]wire.Record{}
	inspection := []map[string]any{}
	if contract != nil {
		contracts[contract.ID] = *contract
	}
	for _, record := range rows {
		var v wire.Result
		if err = wire.Decode(record.Data, &v); err != nil {
			problem(w, r, err)
			return
		}
		if !lanes[v.TrackID] {
			continue
		}
		if len(selected) >= 512 {
			problem(w, r, store.ErrLimit)
			return
		}
		status, reason, e := a.Store.SummaryEligibility(r.Context(), revision, v)
		if e != nil {
			problem(w, r, e)
			return
		}
		eligibility[record.ID] = matrixEligibility{status, reason}
		selected = append(selected, record)
		if inspecting {
			if len(inspection) >= 64 {
				problem(w, r, store.ErrLimit)
				return
			}
			item := map[string]any{"measurement": record, "artifact": nil, "content": "unavailable", "inspection": "unavailable"}
			var summary struct {
				ArtifactID string `json:"artifactId"`
			}
			if err = json.Unmarshal(v.Summary, &summary); err != nil {
				problem(w, r, err)
				return
			}
			if summary.ArtifactID != "" {
				artifact, e := a.Store.Record(revision, "artifact", summary.ArtifactID)
				if e != nil {
					problem(w, r, e)
					return
				}
				descriptor, e := wire.ArtifactData(artifact.Data)
				if e != nil {
					problem(w, r, e)
					return
				}
				item["artifact"] = artifact
				item["content"] = descriptor.Content.Status
				item["inspection"] = descriptor.Inspection.Status
				prefix := "/api/v1/artifacts/" + artifact.ID
				if descriptor.Content.Status == "available" {
					item["bytes"] = prefix + "/bytes?revision=" + revision
				}
				if descriptor.Inspection.Status == "available" {
					item["functions"] = prefix + "/functions?revision=" + revision
					if descriptor.Inspection.Disassembly != nil && descriptor.Inspection.Disassembly.Status == "available" {
						item["disassembly"] = prefix + "/disassembly?revision=" + revision
					}
				}
			}
			inspection = append(inspection, item)
		}
		if _, ok := configs[v.ConfigurationID]; !ok {
			c, e := a.Store.Record(revision, "configuration", v.ConfigurationID)
			if e == nil {
				c, e = configurationSummary(c)
			}
			if e != nil {
				problem(w, r, e)
				return
			}
			configs[c.ID] = c
		}
		if _, ok := contracts[v.ContractID]; !ok {
			c, e := a.Store.Record(revision, "workload", v.ContractID)
			if e != nil {
				problem(w, r, e)
				return
			}
			contracts[c.ID] = c
		}
	}
	// Sort maps for stable bytes and ETags.
	records := func(values map[string]wire.Record) []wire.Record {
		out := []wire.Record{}
		for _, v := range values {
			out = append(out, v)
		}
		sortRecords(out)
		return out
	}
	if inspecting {
		respond(w, r, 200, map[string]any{"revision": revision, "workload": q.Workload, "items": inspection, "eligibility": eligibility, "selectionPolicy": store.HostSelectionVersion}, immutable)
		return
	}
	respond(w, r, 200, map[string]any{"revision": revision, "workload": q.Workload, "results": selected, "eligibility": eligibility, "configurations": records(configs), "contracts": records(contracts), "selectionPolicy": store.HostSelectionVersion}, immutable)
}

func sortRecords(records []wire.Record) {
	sort.Slice(records, func(i, j int) bool { return records[i].ID < records[j].ID })
}
