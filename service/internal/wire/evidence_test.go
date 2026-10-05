package wire

import (
	"strings"
	"testing"
)

func TestEvidenceReferences(t *testing.T) {
	hash := strings.Repeat("a", 64)
	for _, input := range []string{
		`{"references":[12]}`,
		`{"samples":"not-an-array"}`,
		`{"observations":["invalid-hash"]}`,
		`{"references":[],"references":[]}`,
	} {
		if _, err := EvidenceReferences([]byte(input)); err == nil {
			t.Fatalf("accepted %s", input)
		}
	}
	for _, input := range []string{
		`[{"references":["scientific-value"]}]`,
		`{"data":{"samples":"scientific-value","references":["scientific-value"]}}`,
	} {
		refs, err := EvidenceReferences([]byte(input))
		if err != nil || len(refs) != 0 {
			t.Fatalf("interpreted payload as transport links: %v %v", refs, err)
		}
	}
	refs, err := EvidenceReferences([]byte(`{"samples":["` + hash + `"],"references":["` + hash + `"]}`))
	if err != nil || len(refs) != 2 {
		t.Fatal("lost legacy or new links", refs, err)
	}
}
