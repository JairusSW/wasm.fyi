package wire

import (
	"strings"
	"testing"
)

func TestJSONResourceIntegrity(t *testing.T) {
	value := []byte(`{"message":"unicode λ 🦀 and escaped \\ bytes"}`)
	b, _ := Encode(JSONFragment{Kind: "json-fragment", Schema: 1, Text: string(value)})
	digest := Hash(b)
	resource := JSONResource{Kind: "json-resource", Schema: 1, Encoding: "json-utf8", Bytes: len(value), SHA256: Hash(value), References: []string{digest}}
	fetch := func(string) ([]byte, error) { return b, nil }
	envelope, _ := Encode(resource)
	if parsed, err := Resource(append([]byte(" \n"), envelope...)); err != nil || parsed == nil {
		t.Fatal("whitespace bypassed resource verification", err)
	}
	if err := VerifyResource(resource, fetch); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*JSONResource){
		func(r *JSONResource) { r.Bytes-- }, func(r *JSONResource) { r.SHA256 = strings.Repeat("a", 64) }, func(r *JSONResource) { r.Bytes = -1 }, func(r *JSONResource) { r.References = []string{"bad"} },
	} {
		changed := resource
		mutate(&changed)
		if err := VerifyResource(changed, fetch); err == nil {
			t.Fatal("accepted corrupt resource")
		}
	}
	for _, text := range []string{`{"duplicate":1,"duplicate":2}`, `{"invalid":`, strings.Repeat("x", FragmentBytes+1)} {
		bytes, _ := Encode(JSONFragment{Kind: "json-fragment", Schema: 1, Text: text})
		r := JSONResource{Kind: "json-resource", Schema: 1, Encoding: "json-utf8", Bytes: len(text), SHA256: Hash([]byte(text)), References: []string{Hash(bytes)}}
		if err := VerifyResource(r, func(string) ([]byte, error) { return bytes, nil }); err == nil {
			t.Fatal("accepted invalid assembled JSON")
		}
	}
}
