package wire

import "encoding/json"

// Definitions remain producer-owned. This verifies the declared binding, not
// scientific derivation from evidence unavailable to the serving process.
func ValidateMetricBinding(result Result, data json.RawMessage) error {
	var definition struct {
		Name, Unit, Scope, Status, Reason string
		Version                           int
	}
	if json.Unmarshal(data, &definition) != nil || definition.Name != result.Metric {
		return Invalid("result metric differs from definition")
	}
	if result.MetricDefinitionStatus == "unregistered" {
		if definition.Status != "unregistered" || result.Metric != "native.code_size" || definition.Reason == "" {
			return Invalid("invalid unregistered metric marker")
		}
		return nil
	}
	if result.MetricDefinitionStatus != "available" || definition.Status == "unregistered" || definition.Version <= 0 || definition.Unit == "" || definition.Scope == "" {
		return Invalid("incomplete metric definition binding")
	}
	return nil
}
