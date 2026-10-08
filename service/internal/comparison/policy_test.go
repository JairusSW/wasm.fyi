package comparison

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

func closeNumber(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return math.Abs(*a-*b) <= math.Max(1e-12, math.Abs(*b)*1e-12)
}

func TestCurrentSitePointEstimateParity(t *testing.T) {
	b, e := os.ReadFile("../../testdata/cohort-current.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Cases []struct {
			Name     string
			Input    Input
			Expected []struct {
				Configuration string
				Value, Ratio  *float64
				Count         int
				Reports       []string
			}
		}
	}
	if e = json.Unmarshal(b, &fixture); e != nil {
		t.Fatal(e)
	}
	if len(fixture.Cases) != 6 {
		t.Fatal("missing host/weighting/RSS parity coverage")
	}
	for _, f := range fixture.Cases {
		t.Run(f.Name, func(t *testing.T) {
			out, e := Compute(context.Background(), f.Input)
			if e != nil {
				t.Fatal(e)
			}
			if len(out.Populations) != len(f.Expected) {
				t.Fatal("omitted population metadata")
			}
			allReports := map[string]bool{}
			for _, p := range out.Populations {
				for _, report := range p.Reports {
					allReports[report] = true
				}
			}
			for i, p := range out.Populations {
				x := f.Expected[i]
				if p.Configuration != x.Configuration || !closeNumber(p.Value, x.Value) || !closeNumber(p.Ratio, x.Ratio) || p.Count != x.Count {
					t.Fatalf("%s: got value=%v ratio=%v count=%d, expected value=%v ratio=%v count=%d", p.Configuration, p.Value, p.Ratio, p.Count, x.Value, x.Ratio, x.Count)
				}
				if f.Input.Policy == "available-rss-arithmetic-v1" {
					if !reflect.DeepEqual(p.Reports, x.Reports) {
						t.Fatal("RSS population reports drifted")
					}
				} else if p.Count > 0 {
					if len(allReports) != len(x.Reports) {
						t.Fatal("multi-report cohort lost evidence")
					}
					for _, report := range x.Reports {
						if !allReports[report] {
							t.Fatal("cohort report missing")
						}
					}
				}
				if len(p.Members) != p.Count {
					t.Fatal("membership truncated")
				}
				weight := 0.0
				for _, m := range p.Members {
					weight += m.Weight
					if m.Cell.Report == "" || m.Cell.Result == "" {
						t.Fatal("membership provenance missing")
					}
				}
				if p.Count > 0 && math.Abs(weight-1) > 1e-12 {
					t.Fatal("weights do not sum to one")
				}
			}
			if out.Uncertainty != "unavailable" || out.UncertaintyReason == "" {
				t.Fatal("unsupported uncertainty advertised")
			}
		})
	}
}

func number(v float64) *float64 { return &v }
func cell(c string, v float64) Cell {
	return Cell{Configuration: c, Result: "result-" + c, Report: "report-" + c, Status: "ok", Value: number(v)}
}
func basic() Input {
	return Input{Configurations: []string{"a", "b", "missing"}, Baseline: "a", Weighting: "workload", Policy: "shared-geometric-v1", Rows: []Row{
		{Key: "contract-one", Workload: "one", Group: "x", Cells: []Cell{cell("a", 4), cell("b", 16)}},
		{Key: "contract-two", Workload: "two", Group: "x", Cells: []Cell{cell("a", 16), cell("b", 64)}},
		{Key: "contract-three", Workload: "three", Group: "y", Cells: []Cell{cell("a", 64), cell("b", 256)}},
	}}
}

func TestCorpusWeightsContractsMissingBaselineAndPopulations(t *testing.T) {
	in := basic()
	in.Weighting = "corpus"
	out, e := Compute(context.Background(), in)
	if e != nil {
		t.Fatal(e)
	}
	if math.Abs(*out.Populations[0].Value-math.Sqrt(8*64)) > 1e-12 || !closeNumber(out.Populations[1].Ratio, number(4)) {
		t.Fatal("equal corpus weighting drift")
	}
	if !reflect.DeepEqual(out.Omitted, []string{"missing"}) {
		t.Fatal("omitted configurations concealed")
	}
	// Same logical workload with different exact contracts has no shared row.
	in = basic()
	in.Rows = []Row{{Key: "original-contract", Workload: "same-name", Cells: []Cell{cell("a", 4)}}, {Key: "changed-contract", Workload: "same-name", Cells: []Cell{cell("b", 8)}}}
	out, e = Compute(context.Background(), in)
	if e != nil || out.Populations[0].Count != 0 || out.Populations[1].Count != 0 {
		t.Fatal("different workload contracts matched")
	}
	in = basic()
	in.Baseline = "missing"
	out, e = Compute(context.Background(), in)
	if e != nil || out.Populations[0].Value == nil || out.Populations[0].Ratio != nil {
		t.Fatal("missing baseline substituted")
	}
	in = basic()
	in.Policy = "available-rss-arithmetic-v1"
	in.Rows[2].Cells = in.Rows[2].Cells[:1]
	out, e = Compute(context.Background(), in)
	if e != nil || out.Populations[0].Count != 3 || out.Populations[1].Count != 2 || *out.Populations[1].Ratio != (16.0+64)/2/((4.0+16+64)/3) {
		t.Fatal("unequal RSS populations not retained")
	}
	in.Policy = "matched-rss-arithmetic-v1"
	out, e = Compute(context.Background(), in)
	if e != nil || out.Populations[0].Count != 2 || out.Populations[1].Count != 2 || *out.Populations[1].Ratio != 4 {
		t.Fatal("matched RSS population policy")
	}
}

func TestEligibilityValidationAndCancellation(t *testing.T) {
	for _, change := range []func(*Input){
		func(in *Input) { in.Rows[0].Cells[0].Status = "unsupported" },
		func(in *Input) { in.Rows[0].Cells[0].Report = "" },
		func(in *Input) { in.Rows[0].Cells[0].Value = nil },
		func(in *Input) { in.Rows[0].Cells[0].Value = number(0) },
		func(in *Input) { in.Rows[0].Cells[0].Value = number(math.NaN()) },
		func(in *Input) { in.Rows[0].Cells[0].Value = number(math.Inf(1)) },
	} {
		in := basic()
		change(&in)
		out, e := Compute(context.Background(), in)
		if e != nil || out.Populations[0].Count != 2 {
			t.Fatal("ineligible evidence included")
		}
	}
	for _, change := range []func(*Input){
		func(in *Input) { in.Rows = append(in.Rows, in.Rows[0]) },
		func(in *Input) { in.Rows[0].Cells = append(in.Rows[0].Cells, in.Rows[0].Cells[0]) },
		func(in *Input) { in.Configurations = append(in.Configurations, "a") },
		func(in *Input) { in.Baseline = "not-requested" },
		func(in *Input) { in.Policy = "unknown" },
		func(in *Input) { in.Weighting = "corpus"; in.Rows[0].Group = "" },
		func(in *Input) { in.Policy = "available-rss-arithmetic-v1"; in.Weighting = "corpus" },
	} {
		in := basic()
		change(&in)
		if _, e := Compute(context.Background(), in); e == nil {
			t.Fatal("invalid scope accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := Compute(ctx, basic()); e != context.Canceled {
		t.Fatal("cancellation ignored")
	}
}

func TestMembershipIsDetachedAndBoundaryCountsRemainExplicit(t *testing.T) {
	in := basic()
	in.Policy = "available-rss-arithmetic-v1"
	in.Rows[1].Workload = in.Rows[0].Workload // two boundaries of one workload
	out, e := Compute(context.Background(), in)
	if e != nil {
		t.Fatal(e)
	}
	if out.Baseline != "a" || out.Populations[0].Count != 3 || out.Populations[0].Workloads != 2 {
		t.Fatal("RSS boundary/workload counts concealed")
	}
	*in.Rows[0].Cells[0].Value = 999
	if *out.Populations[0].Members[0].Cell.Value != 4 {
		t.Fatal("membership aliases caller state")
	}
	if out.Populations[0].Status != "available" || out.Populations[2].Status != "unavailable" || out.Populations[2].Reason == "" {
		t.Fatal("aggregate availability missing")
	}
}

func TestRatioOutsideFloatingRangeIsUnavailable(t *testing.T) {
	in := basic()
	in.Rows = []Row{{Key: "extreme-values", Workload: "extreme", Cells: []Cell{cell("a", 1e308), cell("b", 1e-308)}}}
	out, e := Compute(context.Background(), in)
	if e != nil {
		t.Fatal(e)
	}
	if out.Populations[1].Value == nil || out.Populations[1].Ratio != nil || out.Populations[1].RatioStatus != "unavailable" || out.Populations[1].RatioReason != "ratio outside finite positive range" {
		t.Fatal("underflow manufactured a zero ratio")
	}
	in.Baseline = "b"
	out, e = Compute(context.Background(), in)
	if e != nil || out.Populations[0].Ratio != nil || out.Populations[0].RatioReason != "ratio outside finite positive range" {
		t.Fatal("overflow exposed an invalid ratio")
	}
}

func TestAggregatePrecisionIncludesBaselineAndExcludedInputs(t *testing.T) {
	for _, policy := range []string{"shared-geometric-v1", "available-rss-arithmetic-v1", "matched-rss-arithmetic-v1"} {
		in := basic()
		in.Policy = policy
		in.Rows[0].Cells[0].ApproximateValue = true
		in.Rows[0].Cells[0].SourceValue = json.RawMessage(`"9007199254740993"`)
		in.Rows[0].Cells[0].Value = number(9007199254740992)
		out, err := Compute(context.Background(), in)
		if err != nil {
			t.Fatal(err)
		}
		if out.ValueRepresentation != "float64" {
			t.Fatal("numeric representation hidden")
		}
		for _, p := range out.Populations {
			if p.Configuration == "missing" {
				if p.RatioUsesApproximateInputs != nil || p.ApproximateInputs != 0 {
					t.Fatal("unavailable ratio invents precision metadata")
				}
				continue
			}
			want := 0
			if p.Configuration == "a" {
				want = 1
			}
			if p.ApproximateInputs != want || p.RatioUsesApproximateInputs == nil || !*p.RatioUsesApproximateInputs {
				t.Fatal("baseline conversion loss hidden", policy, p)
			}
		}
		in.Rows[0].Cells[0].ApproximateValue = false
		in.Rows[0].Cells[0].SourceValue = nil
		in.Rows[0].Cells[1].ApproximateValue = true
		out, err = Compute(context.Background(), in)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range out.Populations {
			if p.RatioUsesApproximateInputs != nil && *p.RatioUsesApproximateInputs != (p.Configuration == "b") {
				t.Fatal("numerator conversion loss leaked to unrelated ratio", policy, p)
			}
		}
		in.Rows[0].Cells[1].Status = "failed"
		out, err = Compute(context.Background(), in)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range out.Populations {
			if p.RatioUsesApproximateInputs != nil && *p.RatioUsesApproximateInputs {
				t.Fatal("exact source falsely marked converted")
			}
		}
	}
}

func TestPerEngineSuccessfulPopulation(t *testing.T) {
	one, nine := 1.0, 9.0
	cell := func(lane string, value *float64) Cell {
		return Cell{Configuration: lane, Status: "ok", Value: value, Report: "report", Result: lane}
	}
	input := Input{Configurations: []string{"a", "b"}, Baseline: "a", Weighting: "workload", Policy: "available-geometric-v1", Rows: []Row{
		{Key: "shared", Workload: "shared", Group: "corpus", Cells: []Cell{cell("a", &one), cell("b", &nine)}},
		{Key: "a-only", Workload: "a-only", Group: "corpus", Cells: []Cell{cell("a", &nine)}},
	}}
	out, err := Compute(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if out.Populations[0].Count != 2 || math.Abs(*out.Populations[0].Value-3) > 1e-12 || out.Populations[1].Count != 1 {
		t.Fatalf("unexpected per-engine populations: %+v", out.Populations)
	}
	input.Policy = "shared-geometric-v1"
	out, err = Compute(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if out.Populations[0].Count != 1 || *out.Populations[0].Value != 1 || out.Populations[1].Count != 1 {
		t.Fatalf("unexpected shared populations: %+v", out.Populations)
	}
	input.Policy = "available-geometric-v1"
	input.Weighting = "corpus"
	if _, err = Compute(context.Background(), input); err != nil {
		t.Fatal(err)
	}
}

func TestAllEnginesIncludesUnavailableLane(t *testing.T) {
	value := 2.0
	input := Input{Configurations: []string{"a", "b"}, Baseline: "a", Weighting: "workload", Policy: "shared-geometric-all-v1", Rows: []Row{{Key: "one", Workload: "one", Group: "corpus", Cells: []Cell{{Configuration: "a", Status: "ok", Value: &value, Report: "report", Result: "result"}}}}}
	out, err := Compute(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if out.Populations[0].Count != 0 || out.Populations[0].Value != nil {
		t.Fatal("unavailable engine must prevent a shared passed population")
	}
	input.Policy = "available-geometric-v1"
	out, err = Compute(context.Background(), input)
	if err != nil || out.Populations[0].Count != 1 {
		t.Fatalf("per-engine population lost successful result: %+v %v", out, err)
	}
}
