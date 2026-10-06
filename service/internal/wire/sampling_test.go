package wire

import (
	"strings"
	"testing"
	"time"
)

func TestSamplingGroupRequiresExactDescriptorAndResultBinding(t *testing.T) {
	result := Result{Runtime: "engine", Workload: "fixture/a", Scenario: "steady", Profile: "timing"}
	group := SamplingGroup{Schema: 1, PassID: "pass", CapturedAt: time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC), Runtime: result.Runtime, Workload: result.Workload, Scenario: result.Scenario, Profile: result.Profile, ManifestSHA256: strings.Repeat("a", 64), TrialsSHA256: strings.Repeat("b", 64), TrialCount: 1}
	group.ID = group.Digest()
	if err := group.Validate(result); err != nil {
		t.Fatal(err)
	}
	changed := group
	changed.TrialCount = 2
	if changed.Validate(result) == nil {
		t.Fatal("sampling digest mutation accepted")
	}
	changed = group
	changed.Runtime = "other"
	changed.ID = changed.Digest()
	if changed.Validate(result) == nil {
		t.Fatal("sampling source assigned to another runtime")
	}
	changed = group
	changed.TrialCount = 0
	changed.ID = changed.Digest()
	if changed.Validate(result) == nil {
		t.Fatal("empty source inferred as a sampling group")
	}
}
