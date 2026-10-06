package wire

import "encoding/json"

// Producer-owned scientific selector metadata. Receipt/exporter identities and
// source pass IDs deliberately do not define a reusable measurement recipe.
type MeasurementMethod struct {
	Schema          int                   `json:"schema"`
	Status          string                `json:"status"`
	Reason          string                `json:"reason,omitempty"`
	Metric          string                `json:"metric"`
	Scenario        string                `json:"scenario"`
	Profile         string                `json:"profile"`
	Statistic       string                `json:"statistic"`
	Recipe          json.RawMessage       `json:"recipe,omitempty"`
	RecipeSHA256    string                `json:"recipeSha256,omitempty"`
	CollectorStatus string                `json:"collectorStatus"`
	Observations    []ObservationIdentity `json:"observations"`
}
type ObservationIdentity struct {
	DefinitionVersion int    `json:"definitionVersion"`
	Unit              string `json:"unit"`
	Scope             string `json:"scope"`
	Phase             string `json:"phase"`
	Collector         string `json:"collector"`
	CollectorVersion  string `json:"collectorVersion"`
	Quality           string `json:"quality"`
	Profile           string `json:"profile"`
	Denominator       string `json:"denominator"`
}

func (m MeasurementMethod) Validate(result Result) error {
	b, e := Encode(m)
	if !IsHash(result.MeasurementMethodID) || Hash(b) != result.MeasurementMethodID {
		return Invalid("measurement method digest differs")
	}
	if e != nil || len(b) > 64*1024 || m.Schema != 1 || m.Metric != result.Metric || m.Scenario != result.Scenario || m.Profile != result.Profile || m.Statistic != result.Statistic {
		return Invalid("invalid measurement method identity")
	}
	if m.Status != "available" && m.Status != "unavailable" {
		return Invalid("invalid measurement method availability")
	}
	if m.CollectorStatus != "recorded" && m.CollectorStatus != "not_recorded" {
		return Invalid("invalid measurement collector availability")
	}
	if len(m.Observations) > 32 || m.Observations == nil || (m.CollectorStatus == "recorded") != (len(m.Observations) > 0) {
		return Invalid("invalid measurement collector inventory")
	}
	if m.Status == "unavailable" {
		if m.Reason == "" || len(m.Reason) > 1024 || len(m.Recipe) != 0 || m.RecipeSHA256 != "" || len(m.Observations) > 0 {
			return Invalid("unavailable method advertises source recipe")
		}
		return nil
	}
	if m.Reason != "" || len(m.Recipe) == 0 || len(m.Recipe) > 32*1024 || !IsHash(m.RecipeSHA256) || Hash(m.Recipe) != m.RecipeSHA256 {
		return Invalid("invalid measurement recipe representation")
	}
	var recipe map[string]json.RawMessage
	if e = Decode(m.Recipe, &recipe); e != nil || recipe == nil {
		return Invalid("invalid measurement recipe")
	}
	var binding struct {
		Protocol int `json:"protocol"`
		Options  struct {
			Profile   string   `json:"profile"`
			Scenarios []string `json:"scenarios"`
		} `json:"options"`
	}
	if e = json.Unmarshal(m.Recipe, &binding); e != nil || binding.Protocol < 0 || binding.Options.Profile != result.Profile || len(binding.Options.Scenarios) != 1 || binding.Options.Scenarios[0] != result.Scenario {
		return Invalid("measurement recipe scope differs")
	}
	seen := map[string]bool{}
	for _, o := range m.Observations {
		if o.DefinitionVersion < 0 {
			return Invalid("invalid observation definition version")
		}
		for _, s := range []string{o.Unit, o.Scope, o.Phase, o.Collector, o.CollectorVersion, o.Quality, o.Profile, o.Denominator} {
			if len(s) > 4096 {
				return Invalid("observation identity exceeds ceiling")
			}
		}
		b, _ := Encode(o)
		id := Hash(b)
		if seen[id] {
			return Invalid("duplicate observation identity")
		}
		seen[id] = true
	}
	return nil
}

func (m MeasurementMethod) ID() string { b, _ := Encode(m); return Hash(b) }

func (r Result) ValidateMethod() error {
	if r.MeasurementMethod == nil {
		if r.MeasurementMethodID != "" {
			return Invalid("method digest has no descriptor")
		}
		return nil // Legacy exports remain readable without invented selectors.
	}
	return r.MeasurementMethod.Validate(r)
}
