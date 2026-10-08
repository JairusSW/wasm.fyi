package api

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type timelineCell struct {
	Value  float64
	Record wire.Record
	Source wire.Result
	Group  string
}
type timelineLane struct {
	Track         string               `json:"track"`
	Value         *float64             `json:"value"`
	Measured      int                  `json:"measured"`
	Reference     int                  `json:"reference"`
	Version       string               `json:"version"`
	Configuration string               `json:"configuration"`
	CollectedAt   string               `json:"collectedAt"`
	Role          string               `json:"role"`
	Release       *wire.HistoryRelease `json:"release"`
	SourceReports int                  `json:"sourceReports"`
	Reports       []string             `json:"reports"`
	Evidence      string               `json:"evidence"`
}
type timelineWorkload struct {
	Workload string      `json:"workload"`
	Group    string      `json:"group"`
	Before   wire.Record `json:"before"`
	After    wire.Record `json:"after"`
	Ratio    float64     `json:"ratio"`
	Reused   bool        `json:"reused"`
}
type timelinePoint struct {
	Date  string         `json:"date"`
	Lanes []timelineLane `json:"lanes"`
}

// Website history uses publisher-declared target dates, never capture times as
// substitutes. Only the selected metric/window is summarized; exact observations
// stay in result resources. Reused observations retain the same identity digest.
func (a *API) historyTimeline(w http.ResponseWriter, r *http.Request, revision string, immutable bool) {
	p := r.URL.Query()
	reader := a.Store.ReadQueryView()
	q := store.Query{Revision: revision, Selection: "current", Environment: p.Get("environment"), Metric: p.Get("metric"), Scenario: p.Get("scenario"), Profile: p.Get("profile"), Statistic: p.Get("statistic"), Workload: p.Get("workload"), Sort: "catalog"}
	if !wire.IsHash(q.Environment) || q.Metric == "" || q.Scenario == "" || q.Statistic == "" {
		problem(w, r, wire.Invalid("timeline requires exact metric context"))
		return
	}
	var tracks []string
	if err := wire.Decode([]byte(p.Get("tracks")), &tracks); err != nil || len(tracks) < 1 || len(tracks) > 32 {
		problem(w, r, wire.Invalid("timeline requires explicit tracks"))
		return
	}
	sort.Strings(tracks)
	lanes := map[string]bool{}
	for _, id := range tracks {
		if !wire.IsHash(id) || lanes[id] {
			problem(w, r, wire.Invalid("invalid timeline tracks"))
			return
		}
		if _, err := reader.Record(revision, "track", id); err != nil {
			problem(w, r, err)
			return
		}
		lanes[id] = true
	}
	if p.Has("environments") {
		if err := wire.Decode([]byte(p.Get("environments")), &q.Environments); err != nil {
			problem(w, r, err)
			return
		}
	}
	var err error
	q.Environments, err = reader.NormalizeHostEnvironments(revision, q.Environment, q.Environments)
	if err != nil {
		problem(w, r, err)
		return
	}
	weighting := p.Get("weighting")
	if weighting != "workload" && weighting != "corpus" {
		problem(w, r, wire.Invalid("explicit history weighting required"))
		return
	}
	from, until := p.Get("from"), p.Get("until")
	if p.Get("datesOnly") == "1" {
		if a.historyIndex == nil {
			problem(w, r, store.ErrNeedsRestart)
			return
		}
		q.Revision = revision
		dates, e := a.historyIndex.CaptureDates(r.Context(), q, tracks)
		if e != nil {
			problem(w, r, e)
			return
		}
		respond(w, r, 200, map[string]any{"revision": revision, "captureDates": dates}, immutable)
		return
	}
	start, startErr := time.Parse("2006-01-02", from)
	end, endErr := time.Parse("2006-01-02", until)
	if startErr != nil || endErr != nil || !start.Before(end) || end.Sub(start) > 10*366*24*time.Hour {
		problem(w, r, wire.Invalid("timeline requires a date window"))
		return
	}
	select {
	case a.calculating <- struct{}{}:
		defer func() { <-a.calculating }()
	default:
		respond(w, r, 429, map[string]string{"error": "history computation concurrency limit"}, false)
		return
	}
	var current []wire.Record
	indexedEligibility := map[string][2]string{}
	referenceFound := false
	if a.historyIndex != nil && a.historyIndex.Revision == revision {
		selected, found, e := a.historyIndex.Reference(r.Context(), q)
		if e != nil {
			problem(w, r, e)
			return
		}
		if found {
			current = selected.Rows
			indexedEligibility = selected.Eligibility
			referenceFound = true
		}
	}
	if !referenceFound {
		current, err = a.resultRows(r.Context(), q, false)
		if err != nil {
			problem(w, r, err)
			return
		}
	}
	historyQuery := q
	outputTrack := p.Get("outputTrack")
	if outputTrack != "" {
		if !lanes[outputTrack] {
			problem(w, r, wire.Invalid("history output track outside requested scope"))
			return
		}
		historyQuery.Track = outputTrack
	}
	var rows []wire.Record
	var bindings []store.HistoryContext
	if a.historyIndex != nil && a.historyIndex.Revision == revision {
		selectedTracks := tracks
		if outputTrack != "" {
			selectedTracks = []string{outputTrack}
		}
		selected, e := a.historyIndex.Select(r.Context(), historyQuery, from, until, selectedTracks)
		if e != nil {
			problem(w, r, e)
			return
		}
		rows = selected.Rows
		bindings = selected.Bindings
		for id, status := range selected.Eligibility {
			indexedEligibility[id] = status
		}
	} else {
		rows, err = a.resultRows(r.Context(), historyQuery, true)
		if err != nil {
			problem(w, r, err)
			return
		}
	}
	qualification := func(record wire.Record, source wire.Result) (string, string, error) {
		if cached, ok := indexedEligibility[record.ID]; ok {
			return cached[0], cached[1], nil
		}
		return reader.SummaryEligibility(r.Context(), revision, source)
	}
	reports := map[string]bool{}
	for _, record := range rows {
		var source wire.Result
		_ = json.Unmarshal(record.Data, &source)
		if lanes[source.TrackID] {
			reports[source.ReportID] = true
		}
	}
	if a.historyIndex == nil || a.historyIndex.Revision != revision {
		bindings, err = reader.ScopedHistoryBindings(r.Context(), revision, reports)
		if err != nil {
			problem(w, r, err)
			return
		}
	}
	contexts := map[string][]store.HistoryContext{}
	dates := map[string]bool{}
	for _, binding := range bindings {
		targets := binding.Binding.TargetDates
		if binding.Binding.TargetDate != "" {
			targets = []string{binding.Binding.TargetDate}
		}
		for _, date := range targets {
			if date >= from && date < until {
				key := binding.Binding.ReportID + ":" + binding.Binding.ConfigurationID
				copy := binding
				copy.Binding.TargetDate = date
				copy.Binding.TargetDates = nil
				contexts[key] = append(contexts[key], copy)
				dates[date] = true
			}
		}
	}
	reference := map[string]map[string]bool{}
	for _, record := range current {
		var source wire.Result
		_ = json.Unmarshal(record.Data, &source)
		if !lanes[source.TrackID] || q.Workload == "" && q.Metric == "time.wall" && strings.HasPrefix(source.Workload, "features/") {
			continue
		}
		if _, ok := historyNumber(record); !ok {
			continue
		}
		status, _, eligibilityErr := qualification(record, source)
		if eligibilityErr != nil {
			problem(w, r, eligibilityErr)
			return
		}
		if status != "ok" {
			continue
		}
		key := source.ContractID
		if reference[key] == nil {
			reference[key] = map[string]bool{}
		}
		reference[key][source.TrackID] = true
	}
	active := map[string]bool{}
	for _, membership := range reference {
		for lane := range membership {
			active[lane] = true
		}
	}
	for key, membership := range reference {
		for lane := range active {
			if !membership[lane] {
				delete(reference, key)
				break
			}
		}
	}
	table := map[string]map[string]map[string]timelineCell{}
	metadata := map[string]map[string]store.HistoryContext{}
	groups := map[string]string{}
	for _, record := range rows {
		var source wire.Result
		_ = json.Unmarshal(record.Data, &source)
		if !lanes[source.TrackID] || reference[source.ContractID] == nil {
			continue
		}
		status, _, eligibilityErr := qualification(record, source)
		if eligibilityErr != nil {
			problem(w, r, eligibilityErr)
			return
		}
		if status != "ok" {
			continue
		}
		number, ok := historyNumber(record)
		if !ok {
			continue
		}
		value, _ := number.Float64()
		if value <= 0 || math.IsInf(value, 0) || math.IsNaN(value) {
			continue
		}
		groupKey := source.ContractID + "\x00" + source.Workload
		group, knownGroup := groups[groupKey]
		if !knownGroup {
			workload, err := reader.Record(revision, "workload", source.ContractID)
			if err != nil {
				problem(w, r, err)
				return
			}
			var meta struct {
				Provenance struct{ Category string }
				Features   []string
				Original   struct{ Tags []string } `json:"original_contract"`
			}
			_ = json.Unmarshal(workload.Data, &meta)
			group, _ = comparison.Category(source.Workload, meta.Provenance.Category, "", meta.Features, meta.Original.Tags)
			groups[groupKey] = group
		}

		for _, binding := range contexts[source.ReportID+":"+source.ConfigurationID] {
			date := binding.Binding.TargetDate
			if table[date] == nil {
				table[date] = map[string]map[string]timelineCell{}
				metadata[date] = map[string]store.HistoryContext{}
			}
			if table[date][source.TrackID] == nil {
				table[date][source.TrackID] = map[string]timelineCell{}
			}
			old, exists := table[date][source.TrackID][source.ContractID]
			if exists && !source.Created.After(old.Source.Created) {
				continue
			}
			table[date][source.TrackID][source.ContractID] = timelineCell{value, record, source, group}
			metadata[date][source.TrackID] = binding
		}
	}
	names := []string{}
	for date := range dates {
		names = append(names, date)
	}
	sort.Strings(names)
	if len(names) > 104 {
		problem(w, r, wire.Invalid("history window exceeds 104 declared dates; narrow the window"))
		return
	}
	mean := func(cells map[string]timelineCell, keys map[string]bool) *float64 {
		counts := map[string]int{}
		count := 0
		for key, cell := range cells {
			if keys == nil || keys[key] {
				counts[cell.Group]++
				count++
			}
		}
		if count == 0 {
			return nil
		}
		if count == 1 {
			for key, cell := range cells {
				if keys == nil || keys[key] {
					value := cell.Value
					return &value
				}
			}
		}
		sum := 0.0
		for key, cell := range cells {
			if keys != nil && !keys[key] {
				continue
			}
			weight := 1 / float64(count)
			if weighting == "corpus" {
				weight = 1 / float64(len(counts)*counts[cell.Group])
			}
			sum += math.Log(cell.Value) * weight
		}
		value := math.Exp(sum)
		return &value
	}
	emittedTracks := tracks
	if outputTrack != "" {
		emittedTracks = []string{outputTrack}
	}
	output := []timelinePoint{}
	for _, date := range names {
		point := timelinePoint{Date: date, Lanes: []timelineLane{}}
		for _, track := range emittedTracks {
			cells := table[date][track]
			binding := metadata[date][track]
			lane := timelineLane{Track: track, Value: mean(cells, nil), Measured: len(cells), Reference: len(reference), Role: binding.Binding.BuildRole, Release: binding.Binding.Release, Reports: []string{}}
			if binding.CollectedAt != nil {
				lane.CollectedAt = binding.CollectedAt.Format("2006-01-02T15:04:05Z")
			}
			lane.Configuration = binding.Binding.ConfigurationID
			if lane.Configuration != "" {
				configuration, err := reader.Record(revision, "configuration", lane.Configuration)
				if err != nil {
					problem(w, r, err)
					return
				}
				var cfg struct {
					Version     string
					Description struct {
						Version string `json:"runtime_version"`
					}
				}
				_ = json.Unmarshal(configuration.Data, &cfg)
				lane.Version = cfg.Version
				if lane.Version == "" {
					lane.Version = cfg.Description.Version
				}
				if binding.Binding.Release != nil {
					lane.Version = binding.Binding.Release.Version
				} else if binding.Binding.SourceRevision != "" {
					lane.Version = binding.Binding.SourceRevision
				}
			}
			identities := []string{}
			seen := map[string]bool{}
			for _, cell := range cells {
				identities = append(identities, cell.Record.ID)
				if !seen[cell.Source.ReportID] {
					lane.Reports = append(lane.Reports, cell.Source.ReportID)
					seen[cell.Source.ReportID] = true
				}
			}
			configurations := map[string]bool{}
			for _, cell := range cells {
				configurations[cell.Source.ConfigurationID] = true
			}
			if len(configurations) > 1 {
				lane.Configuration = ""
				lane.Version = "mixed builds"
				lane.Release = nil
				lane.Role = "mixed"
			}
			sort.Strings(identities)
			sort.Strings(lane.Reports)
			lane.SourceReports = len(lane.Reports)
			if len(lane.Reports) > 4 {
				lane.Reports = lane.Reports[:4]
			}
			if len(identities) > 0 {
				encoded, _ := wire.Encode(identities)
				lane.Evidence = wire.Hash(encoded)
			}
			point.Lanes = append(point.Lanes, lane)
		}
		output = append(output, point)
	}
	workloadRows := []timelineWorkload{}
	summaryCounts := map[string]int{"improved": 0, "regressed": 0, "no practical change": 0, "reused evidence": 0}
	changes := []map[string]any{}
	before, after := p.Get("before"), p.Get("after")
	if before != "" || after != "" {
		if before < from || before >= until || after < from || after >= until {
			problem(w, r, wire.Invalid("change dates outside declared window"))
			return
		}
		for _, track := range tracks {
			keys := map[string]bool{}
			for key, a := range table[before][track] {
				b, ok := table[after][track][key]
				if ok && a.Source.MetricDefinitionID == b.Source.MetricDefinitionID && a.Source.AnalysisVersion == b.Source.AnalysisVersion && a.Source.Profile == b.Source.Profile {
					keys[key] = true
					if track == p.Get("detailsTrack") {
						ratio := b.Value / a.Value
						reused := a.Record.ID == b.Record.ID
						workloadRows = append(workloadRows, timelineWorkload{b.Source.Workload, b.Group, a.Record, b.Record, ratio, reused})
						verdict := "no practical change"
						if reused {
							verdict = "reused evidence"
						} else if ratio < 0.98 {
							verdict = "improved"
						} else if ratio > 1.02 {
							verdict = "regressed"
						}
						summaryCounts[verdict]++
					}
				}
			}
			changes = append(changes, map[string]any{"track": track, "before": mean(table[before][track], keys), "after": mean(table[after][track], keys), "count": len(keys)})
		}
	}
	if selected := p.Get("detailsTrack"); selected != "" && !lanes[selected] {
		problem(w, r, wire.Invalid("history details lane outside requested scope"))
		return
	}
	sort.Slice(workloadRows, func(i, j int) bool {
		a, b := math.Abs(workloadRows[i].Ratio-1), math.Abs(workloadRows[j].Ratio-1)
		if a != b {
			return a > b
		}
		return workloadRows[i].Workload < workloadRows[j].Workload
	})
	normalized := map[string]string{}
	for key := range p {
		if key != "cursor" {
			normalized[key] = p.Get(key)
		}
	}
	normalized["revision"] = revision
	encoded, _ := wire.Encode(normalized)
	query := wire.Hash(append([]byte("history-workload-changes-v1:"), encoded...))
	offset := 0
	if token := p.Get("cursor"); token != "" {
		position, err := a.parse(token)
		if err != nil {
			problem(w, r, err)
			return
		}
		if position.Revision != revision || position.Query != query {
			problem(w, r, wire.Invalid("history cursor scope differs"))
			return
		}
		offset = position.Offset
	}
	limit := 14
	if raw := p.Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			problem(w, r, wire.Invalid("history details page exceeds ceiling"))
			return
		}
	}
	if offset > len(workloadRows) {
		problem(w, r, wire.Invalid("history page offset invalid"))
		return
	}
	pageEnd := offset + limit
	if pageEnd > len(workloadRows) {
		pageEnd = len(workloadRows)
	}
	next := ""
	if pageEnd < len(workloadRows) {
		next = a.sign(cursor{revision, query, pageEnd})
	}
	respond(w, r, 200, map[string]any{"workloads": workloadRows[offset:pageEnd], "total": len(workloadRows), "nextCursor": next, "summaryCounts": summaryCounts, "revision": revision, "items": output, "changes": changes, "policy": "declared-reference-geometric-v1", "timeAxis": "publisher-declared-target-date", "uncertainty": "unavailable", "reference": len(reference), "weighting": weighting}, immutable)
}
