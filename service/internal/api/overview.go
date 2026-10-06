package api

import (
	"encoding/json"
	"net/http"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Overview is a compact projection of a complete cohort, never of a result page.
// Producer recipes and report inventories remain referenced resources.
type overviewCard struct {
	Lane                       string   `json:"lane"`
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
	SourceReports              int      `json:"sourceReports"`
	ActualConfigurations       int      `json:"actualConfigurations"`
}

type overviewDefinition struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Unit    string `json:"unit"`
	Version int    `json:"version"`
}

type overviewInterpretation struct {
	Version               string `json:"version"`
	ContractSelection     string `json:"contractSelection"`
	NumericRepresentation string `json:"numericRepresentation"`
	Population            string `json:"population"`
	Weighting             string `json:"weighting"`
	Reports               string `json:"reports"`
	Uncertainty           string `json:"uncertainty"`
	UncertaintyReason     string `json:"uncertaintyReason"`
	SourceReports         int    `json:"sourceReports"`
	// Exact producer methods define profiles, collectors and observation boundaries.
	Methods []store.CohortSelector `json:"methods"`
}

type overviewResponse struct {
	Revision          string                    `json:"revision"`
	Scope             store.CohortScope         `json:"scope"`
	Cohort            string                    `json:"cohort"`
	Digest            string                    `json:"digest"`
	CategoryPolicy    string                    `json:"categoryPolicy"`
	EligibilityPolicy string                    `json:"eligibilityPolicy"`
	Excluded          map[string]int            `json:"excluded"`
	Definitions       []overviewDefinition      `json:"definitions"`
	Requested         []string                  `json:"requested"`
	Participants      []string                  `json:"participants"`
	Omitted           []string                  `json:"omitted"`
	Cards             []overviewCard            `json:"cards"`
	Interpretation    overviewInterpretation    `json:"interpretation"`
	PublicationChecks overviewPublicationChecks `json:"publicationChecks"`
}

type overviewPublicationChecks struct {
	ByteIntegrity         string `json:"byteIntegrity"`
	SourceVerification    string `json:"sourceVerification"`
	OperatorQualification string `json:"operatorQualification"`
}

func projectOverview(c *store.Cohort, token string) overviewResponse {
	response := overviewResponse{
		Revision: c.Scope.Revision, Scope: c.Scope, Cohort: token, Digest: c.Digest,
		CategoryPolicy: c.CategoryPolicy, EligibilityPolicy: c.EligibilityPolicy, Excluded: c.Excluded,
		Definitions: []overviewDefinition{}, Requested: c.Comparison.Requested, Participants: c.Comparison.Participants, Omitted: c.Comparison.Omitted, Cards: []overviewCard{},
	}
	out := c.Comparison
	reports := map[string]bool{}
	for _, p := range out.Populations {
		configurations := map[string]bool{}
		for _, member := range p.Members {
			configurations[member.Cell.ExactConfiguration] = true
		}
		for _, id := range p.Reports {
			reports[id] = true
		}
		response.Cards = append(response.Cards, overviewCard{p.Configuration, p.Status, p.Reason, p.Value, p.Ratio, p.RatioStatus, p.RatioReason, p.Count, p.ApproximateInputs, p.RatioUsesApproximateInputs, p.Workloads, len(p.Reports), len(configurations)})
	}
	interpretation := overviewInterpretation{Version: comparison.Version, Uncertainty: out.Uncertainty, UncertaintyReason: out.UncertaintyReason, SourceReports: len(reports), Methods: c.Scope.Selectors}
	interpretation.NumericRepresentation = "Aggregate values and ratios are floating-point estimates. Approximate-input counts describe source values that lost precision on conversion; exact originals remain in paged membership. These counts do not describe statistical uncertainty."
	switch c.Scope.Contracts {
	case "latest-in-scope":
		interpretation.ContractSelection = "Each logical workload uses the exact contract at the latest capture time among the requested lanes and workload population. Equal-time contract conflicts are rejected."
	case "all-exact-contracts":
		interpretation.ContractSelection = "All exact workload contracts in the requested lanes and workload population remain separate comparison cells."
	}
	switch out.Policy {
	case "shared-geometric-v1":
		interpretation.Population = "Each participating lane uses the shared set of exact workload contracts. Requested lanes without eligible results are listed as omitted."
	case "available-rss-arithmetic-v1":
		interpretation.Population = "Each lane uses its available current-RSS boundary cells. Numerator and baseline populations can differ; counts are reported separately."
	case "matched-rss-arithmetic-v1":
		interpretation.Population = "Each participating lane uses the shared set of exact workload-contract and current-RSS boundary cells."
	}
	if out.Weighting == "corpus" {
		interpretation.Weighting = "Corpus groups receive equal weight; eligible workload contracts share their group's weight."
	} else if out.Policy == "shared-geometric-v1" {
		interpretation.Weighting = "Eligible workload contracts receive equal weight in the geometric mean."
	} else {
		interpretation.Weighting = "Available boundary cells receive equal weight in the arithmetic mean."
	}
	if len(reports) == 0 {
		interpretation.Reports = "No eligible source-report contributions are available."
	} else if len(reports) == 1 {
		interpretation.Reports = "Contributions reference one source report."
	} else {
		interpretation.Reports = "Contributions merge explicitly referenced source reports."
	}
	response.Interpretation = interpretation
	return response
}

func (a *API) overview(w http.ResponseWriter, r *http.Request, c *store.Cohort, token string, immutable bool) {
	response := projectOverview(c, token)
	revision, err := a.Store.Revision(c.Scope.Revision)
	if err != nil {
		problem(w, r, err)
		return
	}
	response.PublicationChecks = overviewPublicationChecks{revision.Integrity, revision.SourceVerification, revision.Qualification}
	seen := map[string]bool{}
	for _, selector := range c.Scope.Selectors {
		if seen[selector.Definition] {
			continue
		}
		seen[selector.Definition] = true
		record, err := a.Store.Record(c.Scope.Revision, "metric", selector.Definition)
		if err != nil {
			problem(w, r, err)
			return
		}
		var definition overviewDefinition
		if err = json.Unmarshal(record.Data, &definition); err != nil {
			problem(w, r, wire.Invalid("invalid overview metric definition"))
			return
		}
		definition.ID = selector.Definition
		response.Definitions = append(response.Definitions, definition)
	}
	respond(w, r, 200, response, immutable)
}
