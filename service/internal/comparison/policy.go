// Package comparison implements website cohort policies, not measurement
// analysis. Callers supply compatible, revision-selected producer summaries.
package comparison

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

const Version = "wasmfyi-cohort-v4"
const MaxCells = 100000

// A Key is an exact workload contract (plus boundary/definition for RSS).
// Logical workload names alone must never establish compatible measurements.
type Row struct {
	Key      string `json:"key"`
	Workload string `json:"workload"`
	Group    string `json:"group"`
	Cells    []Cell `json:"cells"`
}
type Cell struct {
	Configuration      string          `json:"configuration"`
	ExactConfiguration string          `json:"exactConfiguration,omitempty"`
	Contract           string          `json:"contract,omitempty"`
	Environment        string          `json:"environment,omitempty"`
	Method             string          `json:"method,omitempty"`
	SamplingGroup      string          `json:"samplingGroup,omitempty"`
	Definition         string          `json:"definition,omitempty"`
	SourceValue        json.RawMessage `json:"sourceValue,omitempty"`
	ApproximateValue   bool            `json:"approximateValue,omitempty"`
	Result             string          `json:"result"`
	Report             string          `json:"report"`
	Status             string          `json:"status"`
	Value              *float64        `json:"value"`
}
type Input struct {
	Configurations []string `json:"configurations"`
	Baseline       string   `json:"baseline"`
	Weighting      string   `json:"weighting"`
	Policy         string   `json:"policy"`
	Rows           []Row    `json:"rows"`
}
type Member struct {
	Key      string  `json:"key"`
	Workload string  `json:"workload"`
	Group    string  `json:"group"`
	Weight   float64 `json:"weight"`
	Cell     Cell    `json:"cell"`
}
type Population struct {
	Configuration              string   `json:"configuration"`
	Status                     string   `json:"status"`
	Reason                     string   `json:"reason"`
	Value                      *float64 `json:"value"`
	Ratio                      *float64 `json:"ratio"`
	RatioStatus                string   `json:"ratioStatus"`
	RatioReason                string   `json:"ratioReason"`
	Count                      int      `json:"count"`
	ApproximateInputs          int      `json:"approximateInputs"`
	RatioUsesApproximateInputs *bool    `json:"ratioUsesApproximateInputs"`
	Workloads                  int      `json:"workloads"`
	Members                    []Member `json:"members"`
	Reports                    []string `json:"reports"`
}
type Output struct {
	Version             string       `json:"version"`
	ValueRepresentation string       `json:"valueRepresentation"`
	Baseline            string       `json:"baseline"`
	Policy              string       `json:"policy"`
	Weighting           string       `json:"weighting"`
	Requested           []string     `json:"requested"`
	Participants        []string     `json:"participants"`
	Omitted             []string     `json:"omitted"`
	Populations         []Population `json:"populations"`
	Uncertainty         string       `json:"uncertainty"`
	UncertaintyReason   string       `json:"uncertaintyReason"`
}

func eligible(c Cell) bool {
	return c.Status == "ok" && c.Report != "" && c.Result != "" && c.Value != nil && *c.Value > 0 && !math.IsNaN(*c.Value) && !math.IsInf(*c.Value, 0)
}

// Compute never reads trials or treats a pagination window as a cohort. Row
// order is retained for numerical parity; callers canonicalize it for caching.
func Compute(ctx context.Context, input Input) (Output, error) {
	out := Output{Version: Version, ValueRepresentation: "float64", Baseline: input.Baseline, Policy: input.Policy, Weighting: input.Weighting,
		Requested: append([]string{}, input.Configurations...), Participants: []string{}, Omitted: []string{}, Populations: []Population{},
		Uncertainty: "unavailable", UncertaintyReason: "cross-report independent sampling policy is not defined"}
	if len(input.Configurations) == 0 || len(input.Configurations) > 32 || len(input.Rows) > 10000 {
		return out, fmt.Errorf("cohort scope exceeds bounds")
	}
	if input.Policy != "shared-geometric-all-v1" && input.Policy != "shared-geometric-v1" && input.Policy != "available-geometric-v1" && input.Policy != "available-rss-arithmetic-v1" && input.Policy != "matched-rss-arithmetic-all-v1" && input.Policy != "matched-rss-arithmetic-v1" {
		return out, fmt.Errorf("unknown cohort policy")
	}
	if input.Weighting != "workload" && input.Weighting != "corpus" {
		return out, fmt.Errorf("unknown weighting")
	}
	if input.Policy != "shared-geometric-all-v1" && input.Policy != "shared-geometric-v1" && input.Policy != "available-geometric-v1" && input.Weighting != "workload" {
		return out, fmt.Errorf("RSS boundary cells use equal arithmetic weights")
	}
	requested := map[string]bool{}
	for _, c := range input.Configurations {
		if c == "" || len(c) > 256 || requested[c] {
			return out, fmt.Errorf("invalid requested configurations")
		}
		requested[c] = true
	}
	if !requested[input.Baseline] {
		return out, fmt.Errorf("baseline must be explicitly requested")
	}
	keys := map[string]bool{}
	table := make([]map[string]Cell, len(input.Rows))
	available := map[string]bool{}
	total := 0
	for i, row := range input.Rows {
		if e := ctx.Err(); e != nil {
			return out, e
		}
		if row.Key == "" || len(row.Key) > 4096 || keys[row.Key] || row.Workload == "" || len(row.Workload) > 4096 || len(row.Group) > 256 {
			return out, fmt.Errorf("invalid cohort row identity")
		}
		if input.Weighting == "corpus" && row.Group == "" {
			return out, fmt.Errorf("corpus weighting requires recorded groups")
		}
		keys[row.Key] = true
		table[i] = map[string]Cell{}
		for _, c := range row.Cells {
			total++
			if total > MaxCells {
				return out, fmt.Errorf("cohort cells exceed bound")
			}
			if !requested[c.Configuration] || table[i][c.Configuration].Configuration != "" || len(c.Result) > 256 || len(c.Report) > 256 {
				return out, fmt.Errorf("invalid or duplicate cohort cell")
			}
			table[i][c.Configuration] = c
			if eligible(c) {
				available[c.Configuration] = true
			}
		}
	}
	for _, c := range input.Configurations {
		if available[c] {
			out.Participants = append(out.Participants, c)
		} else {
			out.Omitted = append(out.Omitted, c)
		}
	}
	shared := []int{}
	for i := range input.Rows {
		ok := len(out.Participants) > 0
		sharedParticipants := out.Participants
		if input.Policy == "shared-geometric-all-v1" || input.Policy == "matched-rss-arithmetic-all-v1" {
			sharedParticipants = input.Configurations
		}
		for _, c := range sharedParticipants {
			if !eligible(table[i][c]) {
				ok = false
				break
			}
		}
		if ok {
			shared = append(shared, i)
		}
	}
	values := map[string]float64{}
	for _, configuration := range input.Configurations {
		if e := ctx.Err(); e != nil {
			return out, e
		}
		population := Population{Configuration: configuration, Status: "unavailable", Reason: "no shared compatible cells", Members: []Member{}, Reports: []string{}}
		indices := shared
		if input.Policy == "available-rss-arithmetic-v1" || input.Policy == "available-geometric-v1" {
			indices = []int{}
			for i := range input.Rows {
				if eligible(table[i][configuration]) {
					indices = append(indices, i)
				}
			}
		}
		if !available[configuration] {
			indices = nil
			population.Reason = "configuration has no eligible cells"
		}
		groups := map[string]int{}
		for _, i := range indices {
			groups[input.Rows[i].Group]++
		}
		reports, workloads := map[string]bool{}, map[string]bool{}
		sum := 0.0
		for _, i := range indices {
			if e := ctx.Err(); e != nil {
				return out, e
			}
			row, cell := input.Rows[i], table[i][configuration]
			v := *cell.Value
			cell.Value = &v // Published membership must not alias mutable inputs.
			cell.SourceValue = append(json.RawMessage(nil), cell.SourceValue...)
			weight := 1 / float64(len(indices))
			if input.Weighting == "corpus" {
				weight = 1 / float64(len(groups)*groups[row.Group])
			}
			if input.Policy == "shared-geometric-all-v1" || input.Policy == "shared-geometric-v1" || input.Policy == "available-geometric-v1" {
				sum += weight * math.Log(*cell.Value)
			} else {
				sum += *cell.Value
			}
			if cell.ApproximateValue {
				population.ApproximateInputs++
			}
			population.Members = append(population.Members, Member{Key: row.Key, Workload: row.Workload, Group: row.Group, Weight: weight, Cell: cell})
			reports[cell.Report], workloads[row.Workload] = true, true
		}
		population.Count, population.Workloads = len(indices), len(workloads)
		if len(indices) > 0 {
			v := sum / float64(len(indices))
			if input.Policy == "shared-geometric-all-v1" || input.Policy == "shared-geometric-v1" || input.Policy == "available-geometric-v1" {
				v = math.Exp(sum)
			}
			if math.IsInf(v, 0) || math.IsNaN(v) || v <= 0 {
				return out, fmt.Errorf("aggregate outside finite numerical range")
			}
			population.Value = &v
			population.Status, population.Reason = "available", ""
			values[configuration] = v
		}
		for report := range reports {
			population.Reports = append(population.Reports, report)
		}
		sort.Strings(population.Reports)
		out.Populations = append(out.Populations, population)
	}
	baselineApproximate := false
	for _, p := range out.Populations {
		if p.Configuration == input.Baseline {
			baselineApproximate = p.ApproximateInputs > 0
		}
	}
	for i := range out.Populations {
		p := &out.Populations[i]
		p.RatioStatus, p.RatioReason = "unavailable", "baseline unavailable"
		if p.Value == nil {
			p.RatioReason = "aggregate unavailable"
			continue
		}
		if values[input.Baseline] == 0 {
			continue
		}
		r := *p.Value / values[input.Baseline]
		if p.Configuration == input.Baseline {
			r = 1
		}
		p.RatioReason = "ratio outside finite positive range"
		if r > 0 && !math.IsNaN(r) && !math.IsInf(r, 0) {
			p.Ratio = &r
			p.RatioStatus, p.RatioReason = "available", ""
			uses := p.ApproximateInputs > 0 || baselineApproximate
			p.RatioUsesApproximateInputs = &uses
		}
	}
	return out, nil
}
