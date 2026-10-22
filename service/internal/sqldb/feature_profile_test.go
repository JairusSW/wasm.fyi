package sqldb

import (
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"math"
	"testing"
)

func TestFeatureProfilePersistenceExportAndDedup(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	db, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	capture := fixture()
	capture.FeatureProfile = "classic"
	for i := 0; i < 2; i++ {
		if _, err = db.Put(ctx, capture); err != nil {
			t.Fatal(err)
		}
	}
	var labels, bindings int
	db.reader.QueryRow("SELECT count(*) FROM feature_profiles").Scan(&labels)
	db.reader.QueryRow("SELECT count(*) FROM observation_profiles").Scan(&bindings)
	if labels != 1 || bindings != 1 {
		t.Fatal("profile metadata was duplicated", labels, bindings)
	}
	db.Close()
	db, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	matrix, err := db.Matrix(ctx, MatrixQuery{Platform: hash(capture.Platform), Phase: "steady", Limit: 10})
	if err != nil || len(matrix.Items) != 1 {
		t.Fatal(matrix, err)
	}
	detail, err := db.Detail(ctx, hash(capture.Platform), matrix.Items[0].ObservationID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.FeatureProfile != "classic" {
		t.Fatal("profile lost across reopen", detail.FeatureProfile)
	}
	for i, value := range capture.Results[0].SamplesNs {
		if math.Float64bits(detail.SamplesNs[i]) != math.Float64bits(value) {
			t.Fatal("sample changed", i)
		}
	}
	copied, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer copied.Close()
	seen := 0
	err = db.Export(ctx, func(scope string, p benchdb.Platform, r benchdb.Result) error {
		seen++
		if r.FeatureProfile != "classic" {
			t.Fatal("profile lost during export")
		}
		return copied.ImportBinding(ctx, scope, p, r)
	})
	if err != nil || seen == 0 {
		t.Fatal(seen, err)
	}
	matrix, err = copied.Matrix(ctx, MatrixQuery{Platform: hash(capture.Platform), Phase: "steady", Limit: 10})
	if err != nil || len(matrix.Items) != 1 {
		t.Fatal(matrix, err)
	}
	detail, err = copied.Detail(ctx, hash(capture.Platform), matrix.Items[0].ObservationID)
	if err != nil || detail.FeatureProfile != "classic" {
		t.Fatal("profile lost during SQL copy", detail, err)
	}
}

func TestFeatureProfileCodeEnrichment(t *testing.T) {
	ctx := context.Background()
	db, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	capture := fixture()
	capture.FeatureProfile = "classic"
	code, kind := capture.Results[0].CodeBytes, capture.Results[0].CodeKind
	capture.Results[0].CodeStatus = "not-measured"
	capture.Results[0].CodeBytes = nil
	capture.Results[0].CodeKind = nil
	if _, err = db.Put(ctx, capture); err != nil {
		t.Fatal(err)
	}
	capture.Results[0].CodeStatus = "ok"
	capture.Results[0].CodeBytes = code
	capture.Results[0].CodeKind = kind
	if _, err = db.Put(ctx, capture); err != nil {
		t.Fatal(err)
	}
	matrix, err := db.Matrix(ctx, MatrixQuery{Platform: hash(capture.Platform), Phase: "steady", Limit: 10})
	if err != nil || len(matrix.Items) != 1 {
		t.Fatal(matrix, err)
	}
	detail, err := db.Detail(ctx, hash(capture.Platform), matrix.Items[0].ObservationID)
	if err != nil || detail.CodeStatus != "ok" || detail.FeatureProfile != "classic" {
		t.Fatal("profiled code enrichment lost", detail, err)
	}
}
