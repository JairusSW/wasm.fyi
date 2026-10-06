package wire

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestArtifactDescriptorByteBudgetRetainsSizeOnlyContentState(t *testing.T) {
	value := map[string]any{
		"reportId": Hash([]byte("report")), "measurementAvailable": true,
		"record":     map[string]any{"runtime": "engine", "workload": "fixture/a", "trial": "code-0", "size_bytes": 1234},
		"content":    map[string]any{"status": "unavailable", "reason": ""},
		"inspection": map[string]any{"status": "unavailable"},
	}
	base, err := Encode(value)
	if err != nil {
		t.Fatal(err)
	}
	content := value["content"].(map[string]any)
	content["reason"] = strings.Repeat("x", ArtifactDescriptorBytes-len(base))
	data, err := Encode(value)
	if err != nil || len(data) != ArtifactDescriptorBytes {
		t.Fatal("invalid budget fixture", len(data), err)
	}
	artifact, err := ArtifactData(data)
	if err != nil || artifact.Content.Status != "unavailable" || artifact.Inspection.Status != "unavailable" || artifact.Content.SHA256 != "" {
		t.Fatal("size-only descriptor lost independent availability", artifact, err)
	}
	response, err := Encode(map[string]any{"revision": Hash([]byte("revision")), "record": Record{Kind: "artifact", ID: Hash(data), Data: json.RawMessage(data)}})
	if err != nil || len(response) > 10*1024 {
		t.Fatal("ordinary artifact response exceeds target", len(response), err)
	}
	content["reason"] = content["reason"].(string) + "x"
	tooLarge, err := Encode(value)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ArtifactData(tooLarge); !errors.Is(err, ErrInvalid) {
		t.Fatal("oversized descriptor admitted", err)
	}
}
