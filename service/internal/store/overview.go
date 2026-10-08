package store

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Overview is a compact projection of a complete cohort, never of a result page.
// Producer recipes and report inventories remain referenced resources.
type OverviewCard struct {
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

type OverviewDefinition struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Unit    string `json:"unit"`
	Version int    `json:"version"`
}

type OverviewInterpretation struct {
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
	Methods []CohortSelector `json:"methods"`
}

type OverviewResponse struct {
	Revision          string                    `json:"revision"`
	Scope             CohortScope               `json:"scope"`
	Cohort            string                    `json:"cohort"`
	Digest            string                    `json:"digest"`
	CategoryPolicy    string                    `json:"categoryPolicy"`
	EligibilityPolicy string                    `json:"eligibilityPolicy"`
	Excluded          map[string]int            `json:"excluded"`
	Definitions       []OverviewDefinition      `json:"definitions"`
	Requested         []string                  `json:"requested"`
	Participants      []string                  `json:"participants"`
	Omitted           []string                  `json:"omitted"`
	Cards             []OverviewCard            `json:"cards"`
	Interpretation    OverviewInterpretation    `json:"interpretation"`
	PublicationChecks OverviewPublicationChecks `json:"publicationChecks"`
}

type OverviewPublicationChecks struct {
	ByteIntegrity         string `json:"byteIntegrity"`
	SourceVerification    string `json:"sourceVerification"`
	OperatorQualification string `json:"operatorQualification"`
}

func ProjectOverview(c *Cohort, token string) OverviewResponse {
	response := OverviewResponse{
		Revision: c.Scope.Revision, Scope: c.Scope, Cohort: token, Digest: c.Digest,
		CategoryPolicy: c.CategoryPolicy, EligibilityPolicy: c.EligibilityPolicy, Excluded: c.Excluded,
		Definitions: []OverviewDefinition{}, Requested: c.Comparison.Requested, Participants: c.Comparison.Participants, Omitted: c.Comparison.Omitted, Cards: []OverviewCard{},
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
		response.Cards = append(response.Cards, OverviewCard{p.Configuration, p.Status, p.Reason, p.Value, p.Ratio, p.RatioStatus, p.RatioReason, p.Count, p.ApproximateInputs, p.RatioUsesApproximateInputs, p.Workloads, len(p.Reports), len(configurations)})
	}
	interpretation := OverviewInterpretation{Version: comparison.Version, Uncertainty: out.Uncertainty, UncertaintyReason: out.UncertaintyReason, SourceReports: len(reports), Methods: c.Scope.Selectors}
	interpretation.NumericRepresentation = "Aggregate values and ratios are floating-point estimates. Approximate-input counts describe source values that lost precision on conversion; exact originals remain in paged membership. These counts do not describe statistical uncertainty."
	switch c.Scope.Contracts {
	case "latest-in-scope":
		interpretation.ContractSelection = "Each logical workload uses the exact contract at the latest capture time among the requested lanes and workload population. Equal-time contract conflicts are rejected."
	case "all-exact-contracts":
		interpretation.ContractSelection = "All exact workload contracts in the requested lanes and workload population remain separate comparison cells."
	}
	switch out.Policy {
	case "shared-geometric-all-v1":
		interpretation.Population = "Only successful exact workload contracts shared by every requested lane enter the average."
	case "shared-geometric-v1":
		interpretation.Population = "Each participating lane uses the shared set of exact workload contracts. Requested lanes without eligible results are listed as omitted."
	case "available-geometric-v1":
		interpretation.Population = "Each lane uses its successful workload contracts; populations can differ. Counts are reported separately."
	case "available-rss-arithmetic-v1":
		interpretation.Population = "Each lane uses its available current-RSS boundary cells. Numerator and baseline populations can differ; counts are reported separately."
	case "matched-rss-arithmetic-all-v1":
		interpretation.Population = "Only successful exact workload-contract and RSS boundary cells shared by every requested lane enter the average."
	case "matched-rss-arithmetic-v1":
		interpretation.Population = "Each participating lane uses the shared set of exact workload-contract and current-RSS boundary cells."
	}
	if out.Weighting == "corpus" {
		interpretation.Weighting = "Corpus groups receive equal weight; eligible workload contracts share their group's weight."
	} else if out.Policy == "shared-geometric-all-v1" || out.Policy == "shared-geometric-v1" || out.Policy == "available-geometric-v1" {
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

func (s *Store) BuildOverview(c *Cohort) (OverviewResponse, error) {
	response := ProjectOverview(c, "")
	revision, e := s.Revision(c.Scope.Revision)
	if e != nil {
		return response, e
	}
	response.PublicationChecks = OverviewPublicationChecks{revision.Integrity, revision.SourceVerification, revision.Qualification}
	seen := map[string]bool{}
	for _, selector := range c.Scope.Selectors {
		if seen[selector.Definition] {
			continue
		}
		seen[selector.Definition] = true
		record, e := s.Record(c.Scope.Revision, "metric", selector.Definition)
		if e != nil {
			return response, e
		}
		var definition OverviewDefinition
		if e = json.Unmarshal(record.Data, &definition); e != nil {
			return response, wire.Invalid("invalid overview metric definition")
		}
		definition.ID = selector.Definition
		response.Definitions = append(response.Definitions, definition)
	}
	return response, nil
}
