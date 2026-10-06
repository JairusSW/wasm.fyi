package api

import (
	"encoding/json"
	"math"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestOverviewCompleteFrozenScopeAndBudget(t *testing.T) {
	s, err := store.Open(filepath.Join(t.TempDir(), "live"), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	importCohort(t, s, "first", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Value: 4}, {Runtime: "b", Workload: "fixture/one", Group: "x", Value: 16}})
	revision := importCohort(t, s, "second", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/two", Group: "y", Value: 16}, {Runtime: "b", Workload: "fixture/two", Group: "y", Value: 64}})
	key, err := s.CursorKey()
	if err != nil {
		t.Fatal(err)
	}
	h, err := New(s, strings.Repeat("x", 32), key)
	if err != nil {
		t.Fatal(err)
	}
	scope := apiCohortScope(t, s, revision)
	encoded, _ := wire.Encode(scope)
	path := "/api/v1/overview?version=" + comparison.Version + "&scope=" + url.QueryEscape(string(encoded))
	w := request(t, h, "GET", path, nil, nil)
	var output overviewResponse
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &output) != nil {
		t.Fatal(w.Code, w.Body.String())
	}
	if w.Body.Len() > 50*1024 || len(output.Cards) != 2 || len(output.Definitions) != 1 || output.Revision != revision || output.Interpretation.SourceReports != 2 {
		t.Fatal("overview scope/budget", w.Body.String())
	}
	for _, card := range output.Cards {
		want := 32.0
		if card.Lane == scope.Baseline {
			want = 8
		}
		if card.Value == nil || math.Abs(*card.Value-want) > 1e-10 || card.Count != 2 || card.Workloads != 2 || card.SourceReports != 2 || card.ActualConfigurations != 1 {
			t.Fatal("partial-page card", card)
		}
	}
	if output.Interpretation.Uncertainty != "unavailable" || output.Interpretation.UncertaintyReason == "" || len(output.Interpretation.Methods) != 1 {
		t.Fatal("missing interpretation", output)
	}
	if output.PublicationChecks.ByteIntegrity != "sha256-verified" || output.PublicationChecks.SourceVerification != "producer-asserted" || output.PublicationChecks.OperatorQualification != "not-checked" {
		t.Fatal("overview conflates integrity with source verification", output.PublicationChecks)
	}
	if !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("pinned overview not immutable")
	}
	for _, forbidden := range []string{`"members"`, `"samples"`, `"recipe"`, `"trial"`} {
		if strings.Contains(w.Body.String(), forbidden) {
			t.Fatal("overview preloads evidence", forbidden)
		}
	}
	first := w.Body.String()
	importCohort(t, s, "third", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/three", Group: "z", Value: 100}, {Runtime: "b", Workload: "fixture/three", Group: "z", Value: 400}})
	// An empty cache must reconstruct the old complete comparison identically.
	h, err = New(s, strings.Repeat("x", 32), key)
	if err != nil {
		t.Fatal(err)
	}
	if w = request(t, h, "GET", path, nil, nil); w.Code != 200 || w.Body.String() != first {
		t.Fatal("frozen overview changed", w.Code, w.Body.String())
	}
	scope.Revision = ""
	encoded, _ = wire.Encode(scope)
	w = request(t, h, "GET", "/api/v1/overview?scope="+url.QueryEscape(string(encoded)), nil, nil)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &output) != nil || output.Revision != s.Current() || output.Cards[0].Count != 3 || strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("current scope not resolved once", w.Code, w.Body.String())
	}
	for _, suffix := range []string{"", "?scope={}", "?limit=1", "?scope=" + url.QueryEscape(string(encoded)) + "&limit=1"} {
		if request(t, h, "GET", "/api/v1/overview"+suffix, nil, nil).Code != 400 {
			t.Fatal("invalid overview accepted", suffix)
		}
	}
	// The referenced cohort exposes membership without embedding it in cards.
	w = request(t, h, "GET", "/api/v1/cohorts/"+output.Cohort+"?limit=1", nil, nil)
	var page struct {
		Total int
		Items []json.RawMessage
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 6 || len(page.Items) != 1 {
		t.Fatal("overview membership reference", w.Code, w.Body.String())
	}
}

func TestOverviewInterpretationPreservesRSSPopulations(t *testing.T) {
	one, two := 10.0, 20.0
	c := store.Cohort{Scope: store.CohortScope{}, Comparison: comparison.Output{Policy: "available-rss-arithmetic-v1", Weighting: "workload", Uncertainty: "unavailable", UncertaintyReason: "not independently sampled", Populations: []comparison.Population{
		{Configuration: "a", Value: &one, Count: 1, Workloads: 1, Reports: []string{"report-a"}},
		{Configuration: "b", Value: &two, Count: 2, Workloads: 2, Reports: []string{"report-a", "report-b"}},
	}}}
	out := projectOverview(&c, "token")
	if !strings.Contains(out.Interpretation.Population, "populations can differ") || out.Cards[0].Count != 1 || out.Cards[1].Count != 2 || out.Interpretation.SourceReports != 2 {
		t.Fatal("RSS populations collapsed", out)
	}
	c.Comparison.Policy = "matched-rss-arithmetic-v1"
	if out = projectOverview(&c, "token"); strings.Contains(out.Interpretation.Population, "can differ") {
		t.Fatal("matched policy described as available cells")
	}
	c.Comparison.Populations = nil
	if out = projectOverview(&c, "token"); out.Interpretation.SourceReports != 0 || !strings.HasPrefix(out.Interpretation.Reports, "No eligible") {
		t.Fatal("empty cohort invents source reports")
	}
}

func TestOverviewExplainsRecordedContractSelection(t *testing.T) {
	for _, policy := range []string{"latest-in-scope", "all-exact-contracts"} {
		c := &store.Cohort{Scope: store.CohortScope{Contracts: policy}}
		explanation := projectOverview(c, "fixture").Interpretation.ContractSelection
		if explanation == "" || !strings.Contains(explanation, "requested lanes") {
			t.Fatal("contract scope explanation missing", policy, explanation)
		}
	}
}

func TestOverviewAndAggregateExposeExactSourceConversion(t *testing.T) {
	s, err := store.Open(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rev := importCohort(t, s, "native-precision", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Metric: "native.code_size", ExactValue: "9007199254740993"}, {Runtime: "b", Workload: "fixture/one", Group: "x", Metric: "native.code_size", ExactValue: "4"}})
	scope := apiCohortScope(t, s, rev)
	scope.Collectors = "allow-unrecorded-native-size"
	scope.Definitions = "allow-unregistered-native-size"
	h, err := New(s, strings.Repeat("x", 32), []byte(strings.Repeat("k", 32)))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := wire.Encode(scope)
	query := "?version=" + comparison.Version + "&scope=" + url.QueryEscape(string(body))
	w := request(t, h, "GET", "/api/v1/overview"+query, nil, nil)
	var out overviewResponse
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil {
		t.Fatal("overview precision unavailable", w.Code, w.Body.String())
	}
	if !strings.Contains(out.Interpretation.NumericRepresentation, "exact originals") {
		t.Fatal("floating-point interpretation missing")
	}
	for _, card := range out.Cards {
		want := 0
		if card.Lane == scope.Baseline {
			want = 1
		}
		if card.ApproximateInputs != want || card.RatioUsesApproximateInputs == nil || !*card.RatioUsesApproximateInputs {
			t.Fatal("rounded baseline hidden in overview", card)
		}
	}
	w = request(t, h, "GET", "/api/v1/aggregates"+query, nil, nil)
	var aggregate struct {
		Comparison comparison.Output
		Cohort     string
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &aggregate) != nil || aggregate.Comparison.ValueRepresentation != "float64" {
		t.Fatal("aggregate precision unavailable", w.Code, w.Body.String())
	}
	for _, p := range aggregate.Comparison.Populations {
		want := 0
		if p.Configuration == scope.Baseline {
			want = 1
		}
		if p.ApproximateInputs != want || p.RatioUsesApproximateInputs == nil || !*p.RatioUsesApproximateInputs || len(p.Members) != 0 || len(p.Reports) != 0 {
			t.Fatal("aggregate precision or evidence boundary drift", p)
		}
	}
	w = request(t, h, "GET", "/api/v1/cohorts/"+aggregate.Cohort+"?lane="+scope.Baseline, nil, nil)
	var page struct{ Items []comparison.Member }
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 1 || string(page.Items[0].Cell.SourceValue) != `"9007199254740993"` || !page.Items[0].Cell.ApproximateValue {
		t.Fatal("exact original lost", w.Code, w.Body.String())
	}
}
