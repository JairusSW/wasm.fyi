package sqldb

import (
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"testing"
)

func TestExplicitV8PipelineWinsOnlyIdenticalSourceTie(t *testing.T) {
	s := &benchdb.Source{Repository: "w", Revision: "abc"}
	old := &aggregateConfiguration{key: "a", engine: "v8", backend: "optimizing-only", qualified: true, clock: "2026-09-27T00:00:00Z", source: s}
	correct := *old
	correct.key = "z"
	correct.backend = "turboshaft"
	if !preferConfiguration(&correct, old) || preferConfiguration(old, &correct) {
		t.Fatal("corrected pipeline did not win equal source")
	}
	newer := *old
	newer.clock = "2026-10-04T00:00:00Z"
	if preferConfiguration(&correct, &newer) {
		t.Fatal("older corrected source displaced newer source")
	}
	unrelated := correct
	unrelated.source = &benchdb.Source{Repository: "w", Revision: "other"}
	if preferConfiguration(&unrelated, old) {
		t.Fatal("different revision acquired pipeline preference")
	}
}
