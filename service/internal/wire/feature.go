package wire

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"
)

const FeatureProbePolicy = "recorded-feature-trials-v1"

type FeatureScenario struct {
	PassID     string         `json:"passId"`
	Profile    string         `json:"profile"`
	Scenario   string         `json:"scenario"`
	TrialCount int            `json:"trialCount"`
	Outcomes   map[string]int `json:"outcomes"`
}
type FeatureProbe struct {
	Schema          int               `json:"schema"`
	Policy          string            `json:"policy"`
	ReportID        string            `json:"reportId"`
	EnvironmentID   string            `json:"environmentId"`
	ConfigurationID string            `json:"configurationId"`
	TrackID         string            `json:"trackId"`
	ContractID      string            `json:"contractId"`
	Runtime         string            `json:"runtime"`
	Workload        string            `json:"workload"`
	Feature         string            `json:"feature"`
	Created         time.Time         `json:"created"`
	TrialCount      int               `json:"trialCount"`
	Scenarios       []FeatureScenario `json:"scenarios"`
	Evidence        []string          `json:"evidence"`
}

func FeatureProbeData(data []byte) (FeatureProbe, error) {
	var p FeatureProbe
	if len(data)+512 > 10*1024 {
		return p, Invalid("feature probe descriptor exceeds budget")
	}
	if err := Decode(data, &p); err != nil {
		return p, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return p, err
	}
	for _, name := range []string{"schema", "policy", "reportId", "environmentId", "configurationId", "trackId", "contractId", "runtime", "workload", "feature", "created", "trialCount", "scenarios", "evidence"} {
		value, ok := fields[name]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return p, Invalid("missing feature probe field")
		}
	}
	if p.Schema != 1 || p.Policy != FeatureProbePolicy || !IsHash(p.ReportID) || !IsHash(p.EnvironmentID) || !IsHash(p.ConfigurationID) || !IsHash(p.TrackID) || !IsHash(p.ContractID) || p.Runtime == "" || len(p.Runtime) > 512 || !IsIdentity(p.Feature) || (!strings.HasPrefix(p.Workload, "features/"+p.Feature+"/") && p.Workload != "features/"+p.Feature) || len(p.Workload) > 512 || p.Created.IsZero() || p.TrialCount < 0 || p.TrialCount > 1000000 || p.Scenarios == nil || len(p.Scenarios) > 64 || p.Evidence == nil || len(p.Evidence) > 16 {
		return p, Invalid("invalid feature probe")
	}
	count := 0
	seen := map[string]bool{}
	for _, scenario := range p.Scenarios {
		key := scenario.PassID + "\x00" + scenario.Profile + "\x00" + scenario.Scenario
		if !IsIdentity(scenario.PassID) || !IsIdentity(scenario.Profile) || !IsIdentity(scenario.Scenario) || seen[key] || scenario.TrialCount < 1 || scenario.TrialCount > 1000000 || len(scenario.Outcomes) < 1 || len(scenario.Outcomes) > 32 {
			return p, Invalid("invalid feature scenario")
		}
		seen[key] = true
		total := 0
		for status, n := range scenario.Outcomes {
			if !IsIdentity(status) || n < 1 || n > 1000000 {
				return p, Invalid("invalid feature outcome")
			}
			total += n
		}
		if total != scenario.TrialCount {
			return p, Invalid("feature scenario count differs")
		}
		count += total
	}
	if count != p.TrialCount || (p.TrialCount == 0) != (len(p.Evidence) == 0) {
		return p, Invalid("feature trial population differs")
	}
	for _, ref := range p.Evidence {
		if !IsHash(ref) {
			return p, Invalid("invalid feature evidence")
		}
	}
	return p, nil
}

func (p FeatureProbe) CatalogReferences() map[string]string {
	return map[string]string{"report": p.ReportID, "environment": p.EnvironmentID, "configuration": p.ConfigurationID, "track": p.TrackID, "workload": p.ContractID}
}

// Check logical identities against the referenced exact catalog records.
func (p FeatureProbe) CheckCatalog(records map[string]Record) error {
	for kind, id := range p.CatalogReferences() {
		if _, ok := records[kind+":"+id]; !ok {
			return Invalid("unresolved feature catalog reference")
		}
	}
	for kind, want := range map[string]string{"configuration": p.Runtime, "workload": p.Workload} {
		var identity struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(records[kind+":"+p.CatalogReferences()[kind]].Data, &identity); err != nil {
			return err
		}
		if identity.ID != want {
			return Invalid("feature logical identity differs")
		}
	}
	var report struct {
		Created time.Time `json:"created"`
	}
	if err := json.Unmarshal(records["report:"+p.ReportID].Data, &report); err != nil {
		return err
	}
	if !report.Created.Equal(p.Created) {
		return Invalid("feature collection time differs")
	}
	return nil
}
