package testutil

import (
	"encoding/json"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"time"
)

// FeatureFixture is synthetic and conveys no source-verification qualification.
func FeatureFixture(seed string, created time.Time) (wire.Job, map[string][]byte, error) {
	j, objects, err := Fixture(seed, created)
	if err != nil {
		return j, objects, err
	}
	var result wire.Result
	var workload wire.Record
	var reportCreated time.Time
	for _, object := range j.Exports[0].Manifest.Objects {
		if object.Kind != "record" {
			continue
		}
		var r wire.Record
		if err = wire.Decode(objects[object.SHA256], &r); err != nil {
			return j, objects, err
		}
		if r.Kind == "result" {
			if err = wire.Decode(r.Data, &result); err != nil {
				return j, objects, err
			}
		}
		if r.Kind == "workload" {
			workload = r
		}
		if r.Kind == "report" {
			var source struct {
				Created time.Time `json:"created"`
			}
			if err = json.Unmarshal(r.Data, &source); err != nil {
				return j, objects, err
			}
			reportCreated = source.Created
		}
	}
	add := func(kind string, value any) (string, error) {
		bytes, e := wire.Encode(value)
		if e != nil {
			return "", e
		}
		hash := wire.Hash(bytes)
		objects[hash] = bytes
		j.Exports[0].Manifest.Objects = append(j.Exports[0].Manifest.Objects, wire.Object{SHA256: hash, Bytes: len(bytes), Kind: kind})
		return hash, nil
	}
	for i, status := range []string{"unsupported", "crashed"} {
		var contract map[string]json.RawMessage
		if err = json.Unmarshal(workload.Data, &contract); err != nil {
			return j, objects, err
		}
		name := fmt.Sprintf("features/simd/probe-%d", i)
		contract["id"], _ = wire.Encode(name)
		body, _ := wire.Encode(contract)
		contractID := wire.Hash(body)
		if _, err = add("record", wire.Record{Kind: "workload", ID: contractID, Data: body}); err != nil {
			return j, objects, err
		}
		ref, e := add("evidence", map[string]any{"reportId": result.ReportID, "passId": "probe-pass", "trialId": fmt.Sprint(i), "block": 0, "profile": "timing", "scenario": "steady", "status": status, "reason": "synthetic feature fixture", "samples": []string{}, "observations": []string{}, "references": []string{}})
		if e != nil {
			return j, objects, e
		}
		probe := wire.FeatureProbe{Schema: 1, Policy: wire.FeatureProbePolicy, ReportID: result.ReportID, EnvironmentID: result.EnvironmentID, ConfigurationID: result.ConfigurationID, TrackID: result.TrackID, ContractID: contractID, Runtime: result.Runtime, Workload: name, Feature: "simd", Created: reportCreated, TrialCount: 1, Scenarios: []wire.FeatureScenario{{PassID: "probe-pass", Profile: "timing", Scenario: "steady", TrialCount: 1, Outcomes: map[string]int{status: 1}}}, Evidence: []string{ref}}
		body, _ = wire.Encode(probe)
		if _, err = add("record", wire.Record{Kind: "feature-probe", ID: wire.Hash(body), Data: body}); err != nil {
			return j, objects, err
		}
	}
	manifestBytes, err := wire.Encode(j.Exports[0].Manifest)
	if err != nil {
		return j, objects, err
	}
	j.Exports[0].SHA256 = wire.Hash(manifestBytes)
	return j, objects, nil
}
