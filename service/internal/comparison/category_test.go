package comparison

import (
	"encoding/json"
	"os"
	"testing"
)

func TestCategoryParityAgainstWebsitePolicy(t *testing.T) {
	b, e := os.ReadFile("../../testdata/category-current.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Cases []struct {
			Input struct {
				ID         string
				Features   []string
				Provenance struct{ Category, Feature string }
				Original   struct{ Tags []string } `json:"original_contract"`
			}
			Expected *string
		}
	}
	if e = json.Unmarshal(b, &fixture); e != nil {
		t.Fatal(e)
	}
	if len(fixture.Cases) < 80 {
		t.Fatal("classification coverage missing")
	}
	for _, c := range fixture.Cases {
		got, ok := Category(c.Input.ID, c.Input.Provenance.Category, c.Input.Provenance.Feature, c.Input.Features, c.Input.Original.Tags)
		if c.Expected == nil {
			if ok {
				t.Fatal("guessed unknown category")
			}
			continue
		}
		if !ok || got != *c.Expected {
			t.Fatalf("%s: %q != %q", c.Input.ID, got, *c.Expected)
		}
	}
}
