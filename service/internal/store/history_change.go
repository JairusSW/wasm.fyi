package store

import (
	"context"
	"sort"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const HistoryChangePolicy = "matched-workload-change-v1"

type HistoryChange struct {
	Policy            string      `json:"policy"`
	BeforeScope       CohortScope `json:"beforeScope"`
	AfterScope        CohortScope `json:"afterScope"`
	BeforeDigest      string      `json:"beforeDigest"`
	AfterDigest       string      `json:"afterDigest"`
	Status            string      `json:"status"`
	Reason            string      `json:"reason"`
	Before            *float64    `json:"before"`
	After             *float64    `json:"after"`
	Ratio             *float64    `json:"ratio"`
	MatchedCells      int         `json:"matchedCells"`
	MatchedWorkloads  int         `json:"matchedWorkloads"`
	BeforeOnlyCells   int         `json:"beforeOnlyCells"`
	AfterOnlyCells    int         `json:"afterOnlyCells"`
	ReusedCells       int         `json:"reusedCells"`
	ApproximateInputs int         `json:"approximateInputs"`
	Uncertainty       string      `json:"uncertainty"`
	UncertaintyReason string      `json:"uncertaintyReason"`
}

func (s *Store) CompareHistory(ctx context.Context, before, after CohortScope) (HistoryChange, error) {
	if before.Revision == "" || after.Revision == "" {
		return HistoryChange{}, wire.Invalid("explicit before and after revisions required")
	}
	out := HistoryChange{Policy: HistoryChangePolicy, Status: "unavailable", Uncertainty: "unavailable", UncertaintyReason: "matched workload identity does not establish paired independent launch samples"}
	var e error
	before, e = s.NormalizeCohort(before)
	if e != nil {
		return out, e
	}
	after, e = s.NormalizeCohort(after)
	if e != nil {
		return out, e
	}
	if before.Environment != after.Environment || before.LaneKind != "track" || after.LaneKind != "track" || len(before.Lanes) != 1 || len(after.Lanes) != 1 || before.Lanes[0] != after.Lanes[0] {
		return out, wire.Invalid("history changes require one stable runtime track and exact environment")
	}
	a, b := before, after
	a.Revision = ""
	b.Revision = ""
	a.Selection = ""
	b.Selection = ""
	encodedA, _ := wire.Encode(a)
	encodedB, _ := wire.Encode(b)
	if string(encodedA) != string(encodedB) {
		return out, wire.Invalid("history change methods and population policies must match")
	}
	left, e := s.ComputeCohort(ctx, before)
	if e != nil {
		return out, e
	}
	right, e := s.ComputeCohort(ctx, after)
	if e != nil {
		return out, e
	}
	out.BeforeScope, out.AfterScope = before, after
	out.BeforeDigest, out.AfterDigest = left.Digest, right.Digest
	index := func(c Cohort) (map[string]comparison.Member, error) {
		rows := map[string]comparison.Member{}
		for _, p := range c.Comparison.Populations {
			for _, m := range p.Members {
				if _, exists := rows[m.Key]; exists {
					return nil, wire.Invalid("duplicate history member key")
				}
				rows[m.Key] = m
			}
		}
		return rows, nil
	}
	prior, e := index(left)
	if e != nil {
		return out, e
	}
	next, e := index(right)
	if e != nil {
		return out, e
	}
	keys := []string{}
	for k := range prior {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	rows := []comparison.Row{}
	workloads := map[string]bool{}
	for _, key := range keys {
		if e = ctx.Err(); e != nil {
			return out, e
		}
		old := prior[key]
		current, ok := next[key]
		if !ok {
			continue
		}
		if old.Cell.Contract != current.Cell.Contract || old.Cell.Method != current.Cell.Method || old.Cell.Definition != current.Cell.Definition || old.Workload != current.Workload || old.Group != current.Group {
			return out, wire.Invalid("matched history cell identities differ")
		}
		first, last := old.Cell, current.Cell
		first.Configuration = "before"
		last.Configuration = "after"
		rows = append(rows, comparison.Row{Key: key, Workload: old.Workload, Group: old.Group, Cells: []comparison.Cell{first, last}})
		workloads[old.Workload] = true
		if old.Cell.Result == current.Cell.Result || old.Cell.SamplingGroup != "" && old.Cell.SamplingGroup == current.Cell.SamplingGroup {
			out.ReusedCells++
		}
	}
	out.MatchedCells = len(rows)
	out.MatchedWorkloads = len(workloads)
	out.BeforeOnlyCells = len(prior) - len(rows)
	out.AfterOnlyCells = len(next) - len(rows)
	if len(rows) == 0 {
		out.Reason = "no compatible exact workload contracts are available at both selections"
		return out, nil
	}
	computed, e := comparison.Compute(ctx, comparison.Input{Configurations: []string{"before", "after"}, Baseline: "before", Weighting: before.Weighting, Policy: before.Policy, Rows: rows})
	if e != nil {
		return out, wire.Invalid(e.Error())
	}
	for _, p := range computed.Populations {
		out.ApproximateInputs += p.ApproximateInputs
		if p.Configuration == "before" {
			out.Before = p.Value
		} else {
			out.After = p.Value
			out.Ratio = p.Ratio
			out.Status = p.RatioStatus
			out.Reason = p.RatioReason
		}
	}
	return out, nil
}
