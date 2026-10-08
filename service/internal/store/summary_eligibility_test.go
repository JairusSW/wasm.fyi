package store

import (
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"testing"
)

func TestMeasuredNativeSizeDoesNotRequireExportedBytes(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	value := wire.Result{Metric: "native.code_size", Statistic: "size_bytes", Summary: json.RawMessage(`{"status":"unavailable","size_bytes":123,"size_source":"engine_reported"}`)}
	status, reason, err := s.SummaryEligibility(context.Background(), "", value)
	if err != nil || status != "ok" || reason != "" {
		t.Fatalf("measured size discarded: %s %s %v", status, reason, err)
	}
	value.Summary = json.RawMessage(`{"status":"unavailable","size_bytes":null}`)
	status, _, err = s.SummaryEligibility(context.Background(), "", value)
	if err != nil || status != "unavailable" {
		t.Fatal("absent size became available", status, err)
	}
}
