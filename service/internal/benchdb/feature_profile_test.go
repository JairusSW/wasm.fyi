package benchdb

import (
	"context"
	"strings"
	"testing"
)

func TestFeatureProfileLegacyRoundTrip(t *testing.T) {
	ctx := context.Background()
	db, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	c := fixture("2026-10-22T00:00:00Z", 1)
	c.FeatureProfile = "classic"
	if _, err = db.Put(ctx, c); err != nil {
		t.Fatal(err)
	}
	platforms, err := db.Platforms(ctx)
	if err != nil {
		t.Fatal(err)
	}
	page, err := db.Page(ctx, Query{Platform: platforms.Items[0].ID, Phase: "steady", Limit: 10})
	if err != nil || len(page.Items) != 1 || page.Items[0].FeatureProfile != "classic" {
		t.Fatal(page, err)
	}
	seen := 0
	err = db.ExportBindings(ctx, func(_ string, _ Platform, r Result) error {
		seen++
		if r.FeatureProfile != "classic" {
			t.Fatal("profile lost in legacy export")
		}
		return nil
	})
	if err != nil || seen == 0 {
		t.Fatal(seen, err)
	}
}
func TestFeatureProfileLabelsAreBounded(t *testing.T) {
	for _, profile := range []string{"fast", "classic", strings.Repeat("a", 32), "feature-2"} {
		if !validFeatureProfile(profile) {
			t.Fatal("valid profile rejected", profile)
		}
	}
	for _, profile := range []string{"../classic", "-classic", "Classic", "classic profile", "classic\n", strings.Repeat("a", 33)} {
		if validFeatureProfile(profile) {
			t.Fatal("invalid profile accepted", profile)
		}
	}
}
