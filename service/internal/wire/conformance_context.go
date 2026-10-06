package wire

import (
	"encoding/json"
	"time"
)

type ConformanceHost struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
}

type ConformanceContext struct {
	Schema               int             `json:"schema"`
	SourceID             string          `json:"sourceId"`
	Created              time.Time       `json:"created"`
	Host                 ConformanceHost `json:"host"`
	HostIdentity         string          `json:"hostIdentity"`
	CoverageCount        *int            `json:"coverageCount"`
	InterpretationSource string          `json:"interpretationSource"`
}

func ConformanceContextData(data []byte) (ConformanceContext, error) {
	var value ConformanceContext
	if len(data)+512 > 10*1024 {
		return value, Invalid("conformance context exceeds budget")
	}
	if err := Decode(data, &value); err != nil {
		return value, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return value, err
	}
	if _, ok := fields["coverageCount"]; !ok {
		return value, Invalid("missing coverage availability")
	}
	if value.Schema != 1 || !IsHash(value.SourceID) || !IsHash(value.HostIdentity) || value.Created.IsZero() || value.Created.Year() < 1 || value.Created.Year() > 9999 || value.InterpretationSource != "publisher-asserted" || value.CoverageCount != nil && (*value.CoverageCount < 0 || *value.CoverageCount > 128) {
		return value, Invalid("invalid conformance context")
	}
	if len(value.Host.Hostname) < 1 || len(value.Host.Hostname) > 255 || len(value.Host.OS) < 1 || len(value.Host.OS) > 64 || len(value.Host.Arch) < 1 || len(value.Host.Arch) > 64 {
		return value, Invalid("invalid recorded conformance environment")
	}
	return value, nil
}

type ConformanceCoverage struct {
	Schema               int       `json:"schema"`
	SourceID             string    `json:"sourceId"`
	Created              time.Time `json:"created"`
	Engine               string    `json:"engine"`
	Status               string    `json:"status"`
	Reason               *string   `json:"reason"`
	InterpretationSource string    `json:"interpretationSource"`
}

func ConformanceCoverageData(data []byte) (ConformanceCoverage, error) {
	var value ConformanceCoverage
	if len(data)+512 > 10*1024 {
		return value, Invalid("conformance coverage descriptor exceeds budget")
	}
	if err := Decode(data, &value); err != nil {
		return value, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return value, err
	}
	if _, ok := fields["reason"]; !ok {
		return value, Invalid("missing coverage reason availability")
	}
	if value.Schema != 1 || !IsHash(value.SourceID) || value.Created.IsZero() || value.Created.Year() < 1 || value.Created.Year() > 9999 || !IsIdentity(value.Engine) || (value.Status != "selected" && value.Status != "uncollected") || value.Reason != nil && len(*value.Reason) > 2048 || value.InterpretationSource != "publisher-asserted" {
		return value, Invalid("invalid conformance coverage")
	}
	return value, nil
}

func IsConformanceKind(kind string) bool {
	return kind == "conformance" || kind == "conformance-source" || kind == "conformance-context" || kind == "conformance-coverage"
}

// All source-scoped metadata use the same membership index and cursor policy.
func ConformanceMetadataSource(kind string, data []byte) (string, error) {
	switch kind {
	case "conformance":
		v, e := ConformanceLaneData(data)
		return v.SourceID, e
	case "conformance-context":
		v, e := ConformanceContextData(data)
		return v.SourceID, e
	case "conformance-coverage":
		v, e := ConformanceCoverageData(data)
		return v.SourceID, e
	default:
		return "", Invalid("unsupported conformance metadata")
	}
}
