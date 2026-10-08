package api

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"math/big"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type matrixEligibility struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}
type matrixRow struct {
	Eligibility map[string]matrixEligibility `json:"eligibility"`
	Workload    wire.Record                  `json:"workload"`
	Results     []wire.Record                `json:"results"`
	Group       string                       `json:"group"`
}
type matrixQuery struct {
	CohortMode string      `json:"cohortMode,omitempty"`
	Query      store.Query `json:"query"`
	Tracks     []string    `json:"tracks"`
	Search     string      `json:"search"`
	Tag        string      `json:"tag"`
	SortTrack  string      `json:"sortTrack"`
	Direction  string      `json:"direction"`
}

// Paginate logical workload rows after complete selection/filtering/sorting.
// A returned row includes all requested lanes, so absent pages cannot be mistaken
// for missing measurement cells. Results remain canonical summary references.
func (a *API) matrix(w http.ResponseWriter, r *http.Request, revision string, n int, c cursor, immutable bool) {
	if n > 100 {
		problem(w, r, wire.Invalid("matrix page exceeds workload ceiling"))
		return
	}
	p := r.URL.Query()
	if p.Has("version") && p.Get("version") != "matrix-v3" {
		problem(w, r, wire.Invalid("unsupported matrix version"))
		return
	}
	immutable = immutable && p.Get("version") == "matrix-v3"
	q := matrixQuery{CohortMode: p.Get("cohortMode"), Query: store.Query{Revision: revision, Selection: p.Get("selection"), Environment: p.Get("environment"), Metric: p.Get("metric"), Scenario: p.Get("scenario"), Profile: p.Get("profile"), Statistic: p.Get("statistic"), Workload: p.Get("workload"), Sort: "catalog", Limit: n}, Search: strings.ToLower(strings.TrimSpace(p.Get("search"))), Tag: p.Get("tag"), SortTrack: p.Get("sortTrack"), Direction: p.Get("direction")}
	if q.CohortMode != "" && q.CohortMode != "shared" && q.CohortMode != "per-engine" {
		problem(w, r, wire.Invalid("invalid average corpus selection"))
		return
	}
	if q.Query.Selection == "" || q.Query.Selection == "s1" {
		q.Query.Selection = "current"
	}
	if q.Query.Selection == "s2" {
		q.Query.Selection = "previous"
	}
	if q.Query.Selection != "current" && q.Query.Selection != "previous" || !wire.IsHash(q.Query.Environment) || q.Query.Metric == "" || q.Query.Scenario == "" || q.Query.Statistic == "" || len(q.Search) > 128 || len(q.Tag) > 128 || q.Direction != "" && q.Direction != "asc" && q.Direction != "desc" {
		problem(w, r, wire.Invalid("invalid matrix scope"))
		return
	}
	if p.Has("environments") {
		if err := wire.Decode([]byte(p.Get("environments")), &q.Query.Environments); err != nil || len(q.Query.Environments) == 0 {
			problem(w, r, wire.Invalid("invalid matrix host membership"))
			return
		}
	}
	var err error
	q.Query.Environments, err = a.Store.NormalizeHostEnvironments(revision, q.Query.Environment, q.Query.Environments)
	if err != nil {
		problem(w, r, err)
		return
	}
	if err = wire.Decode([]byte(p.Get("tracks")), &q.Tracks); err != nil || len(q.Tracks) < 1 || len(q.Tracks) > 32 {
		problem(w, r, wire.Invalid("explicit matrix lanes required"))
		return
	}
	sort.Strings(q.Tracks)
	tracks := map[string]bool{}
	for _, id := range q.Tracks {
		if !wire.IsHash(id) || tracks[id] {
			problem(w, r, wire.Invalid("invalid matrix lanes"))
			return
		}
		if _, err = a.Store.Record(revision, "track", id); err != nil {
			problem(w, r, err)
			return
		}
		tracks[id] = true
	}
	if q.SortTrack != "" && !tracks[q.SortTrack] {
		problem(w, r, wire.Invalid("sort track is outside requested lanes"))
		return
	}
	encoded, _ := wire.Encode(q)
	query := wire.Hash(append([]byte("matrix-workloads-v3:"), encoded...))
	if c.Revision != "" && (c.Revision != revision || c.Query != query) {
		problem(w, r, wire.Invalid("cursor scope differs"))
		return
	}
	records, err := a.resultRows(r.Context(), q.Query, false)
	if err != nil {
		problem(w, r, err)
		return
	}
	type row struct {
		matrixRow
		name         string
		created      time.Time
		number       *big.Rat
		scoreCreated time.Time
		scoreID      string
		scoreProfile string
	}
	byName := map[string]*row{}
	// Workload metadata includes known contracts with no selected observation.
	// This is a bounded catalog, never a report/evidence preload.
	for offset := 0; ; {
		page, err := a.Store.CatalogPage(r.Context(), revision, "workload", offset, 100)
		if err != nil {
			problem(w, r, err)
			return
		}
		if page.Total > 4096 {
			problem(w, r, store.ErrLimit)
			return
		}
		for _, record := range page.Items {
			var metadata struct{ ID string }
			_ = json.Unmarshal(record.Data, &metadata)
			if metadata.ID == "mechanisms/wasm-to-host-call" {
				continue
			}
			if q.Query.Workload != "" && q.Query.Workload != metadata.ID {
				continue
			}
			if byName[metadata.ID] == nil {
				byName[metadata.ID] = &row{matrixRow: matrixRow{Workload: record, Results: []wire.Record{}, Eligibility: map[string]matrixEligibility{}}, name: metadata.ID}
			}
		}
		if page.Next >= page.Total {
			break
		}
		offset = page.Next
	}
	for _, record := range records {
		if err = r.Context().Err(); err != nil {
			problem(w, r, err)
			return
		}
		var value wire.Result
		if err = wire.Decode(record.Data, &value); err != nil {
			problem(w, r, err)
			return
		}
		if !tracks[value.TrackID] {
			continue
		}
		name := value.Workload
		if name == "mechanisms/wasm-to-host-call" {
			continue
		}
		current := byName[name]
		if current == nil {
			current = &row{matrixRow: matrixRow{Results: []wire.Record{}, Eligibility: map[string]matrixEligibility{}}, name: name}
			byName[name] = current
		}
		status, reason, err := a.Store.SummaryEligibility(r.Context(), revision, value)
		if err != nil {
			problem(w, r, err)
			return
		}
		current.Eligibility[record.ID] = matrixEligibility{status, reason}
		current.Results = append(current.Results, record)
		// The header describes the latest exact contract; each cell retains its own
		// contract ID. Comparisons use their separately declared contract policy.
		created := value.Created
		if current.Workload.ID == "" || created.After(current.created) || created.Equal(current.created) && value.ContractID > current.Workload.ID {
			current.Workload, err = a.Store.Record(revision, "workload", value.ContractID)
			if err != nil {
				problem(w, r, err)
				return
			}
			current.created = created
		}
		if value.TrackID == q.SortTrack && (current.scoreID == "" || value.Created.After(current.scoreCreated) || value.Created.Equal(current.scoreCreated) && preferredMatrixResult(value.Profile, record.ID, current.scoreProfile, current.scoreID, value.Metric)) {
			current.scoreCreated = value.Created
			current.scoreID = record.ID
			current.scoreProfile = value.Profile
			current.number = nil
			var summary map[string]json.RawMessage
			_ = json.Unmarshal(value.Summary, &summary)
			text := string(summary[value.Statistic])
			if strings.HasPrefix(text, "\"") {
				_ = json.Unmarshal(summary[value.Statistic], &text)
			}
			var outcomes map[string]int
			_ = json.Unmarshal(summary["outcomes"], &outcomes)
			failed := false
			for status, count := range outcomes {
				failed = failed || count > 0 && status != "ok" && status != "unsupported"
			}
			if status == "ok" && !failed && len(text) <= 128 {
				if number, ok := new(big.Rat).SetString(text); ok {
					current.number = number
				}
			}
		}
	}
	rows := []*row{}
	for _, value := range byName {
		var metadata struct {
			Features   []string
			Provenance struct{ Category string }
			Original   struct{ Tags []string } `json:"original_contract"`
		}
		_ = json.Unmarshal(value.Workload.Data, &metadata)
		value.Group, _ = comparison.Category(value.name, metadata.Provenance.Category, "", metadata.Features, metadata.Original.Tags)
		if value.Group == "" {
			value.Group = "Other workloads"
		}
		search := strings.ToLower(strings.NewReplacer("-", " ", "/", " ", "_", " ").Replace(value.name))
		if q.Search != "" && !strings.Contains(search, q.Search) && !strings.Contains(strings.ToLower(value.name), q.Search) {
			continue
		}
		if q.Tag != "" {
			found := false
			for _, tag := range append(metadata.Features, metadata.Original.Tags...) {
				found = found || tag == q.Tag
			}
			if !found {
				continue
			}
		}
		rows = append(rows, value)
	}
	type groupCell struct {
		Track string   `json:"track"`
		Value *float64 `json:"value"`
		Count int      `json:"count"`
	}
	type groupSummary struct {
		Name  string      `json:"name"`
		Total int         `json:"total"`
		Cells []groupCell `json:"cells"`
	}
	totals := map[string]int{}
	sums := map[string]map[string]*big.Rat{}
	counts := map[string]map[string]int{}
	for _, row := range rows {
		totals[row.Group]++
		if sums[row.Group] == nil {
			sums[row.Group] = map[string]*big.Rat{}
			counts[row.Group] = map[string]int{}
		}
		latest := map[string]wire.Record{}
		dates := map[string]time.Time{}
		profiles := map[string]string{}
		for _, record := range row.Results {
			var value wire.Result
			_ = wire.Decode(record.Data, &value)
			if old, ok := latest[value.TrackID]; !ok || value.Created.After(dates[value.TrackID]) || value.Created.Equal(dates[value.TrackID]) && preferredMatrixResult(value.Profile, record.ID, profiles[value.TrackID], old.ID, value.Metric) {
				latest[value.TrackID] = record
				dates[value.TrackID] = value.Created
				profiles[value.TrackID] = value.Profile
			}
		}
		rowValues := map[string]*big.Rat{}
		for track, record := range latest {
			if row.Eligibility[record.ID].Status != "ok" {
				continue
			}
			var value wire.Result
			_ = wire.Decode(record.Data, &value)
			var summary map[string]json.RawMessage
			_ = json.Unmarshal(value.Summary, &summary)
			var outcomes map[string]int
			_ = json.Unmarshal(summary["outcomes"], &outcomes)
			failed := false
			for status, count := range outcomes {
				failed = failed || count > 0 && status != "ok" && status != "unsupported"
			}
			if failed {
				continue
			}
			text := string(summary[value.Statistic])
			if strings.HasPrefix(text, "\"") {
				_ = json.Unmarshal(summary[value.Statistic], &text)
			}
			number, ok := new(big.Rat).SetString(text)
			if !ok || number.Sign() < 0 || value.Metric == "time.wall" && number.Sign() == 0 || len(text) > 128 {
				continue
			}
			rowValues[track] = number
		}
		if q.CohortMode == "shared" && len(rowValues) != len(q.Tracks) {
			continue
		}
		for track, number := range rowValues {
			if sums[row.Group][track] == nil {
				sums[row.Group][track] = new(big.Rat)
			}
			sums[row.Group][track].Add(sums[row.Group][track], number)
			counts[row.Group][track]++
		}
	}
	groups := []groupSummary{}
	names := []string{}
	for name := range totals {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		group := groupSummary{Name: name, Total: totals[name], Cells: []groupCell{}}
		for _, track := range q.Tracks {
			cell := groupCell{Track: track, Count: counts[name][track]}
			if cell.Count > 0 {
				mean := new(big.Rat).Quo(sums[name][track], big.NewRat(int64(cell.Count), 1))
				value, _ := mean.Float64()
				cell.Value = &value
			}
			group.Cells = append(group.Cells, cell)
		}
		groups = append(groups, group)
	}
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.Group != b.Group {
			return a.Group < b.Group
		}
		if q.SortTrack != "" {
			if (a.number == nil) != (b.number == nil) {
				return a.number != nil
			}
			if a.number != nil && a.number.Cmp(b.number) != 0 {
				if q.Direction == "desc" {
					return a.number.Cmp(b.number) > 0
				}
				return a.number.Cmp(b.number) < 0
			}
		}
		return a.name < b.name
	})
	if c.Offset > len(rows) {
		problem(w, r, wire.Invalid("matrix cursor offset invalid"))
		return
	}
	items := []matrixRow{}
	end := c.Offset
	size := 4096
	for end < len(rows) && end-c.Offset < n {
		encoded, err := wire.Encode(rows[end].matrixRow)
		if err != nil {
			problem(w, r, err)
			return
		}
		if size+len(encoded) > wire.ResponseBytes {
			break
		}
		size += len(encoded)
		items = append(items, rows[end].matrixRow)
		end++
	}
	if end == c.Offset && end < len(rows) {
		problem(w, r, store.ErrLimit)
		return
	}
	next := ""
	if end < len(rows) {
		next = a.sign(cursor{revision, query, end})
	}
	policy := "exact-environment-v1"
	if len(q.Query.Environments) > 0 {
		policy = store.HostSelectionVersion
	}
	respond(w, r, 200, map[string]any{"revision": revision, "scope": q, "selectionPolicy": policy, "items": items, "nextCursor": next, "complete": end == len(rows), "total": len(rows), "groups": groups}, immutable)
}

// A separately collected memory pass wins tied capture timestamps; otherwise
// use a deterministic source identity without changing the stored observation.
func preferredMatrixResult(profile, id, oldProfile, oldID, metric string) bool {
	if strings.HasPrefix(metric, "process.") && profile != oldProfile {
		if profile == "memory" {
			return true
		}
		if oldProfile == "memory" {
			return false
		}
	}
	return id > oldID
}
