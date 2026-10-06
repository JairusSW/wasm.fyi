package store

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestMeasuredWorkloadLookupIsRevisionScoped(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := publishTest(t, s, "hosting", time.Now().UTC())
	rows, e := s.Results(Query{Revision: rev}, false)
	if e != nil || len(rows) == 0 {
		t.Fatal(e)
	}
	for _, row := range rows {
		var v wire.Result
		if e = json.Unmarshal(row.Data, &v); e != nil {
			t.Fatal(e)
		}
		for _, revision := range []string{"", rev} {
			ok, e := s.HasMeasuredWorkload(context.Background(), revision, v.Workload)
			if e != nil || !ok {
				t.Fatalf("workload lookup %q: %v", v.Workload, e)
			}
		}
	}
	if ok, e := s.HasMeasuredWorkload(context.Background(), rev, "never-measured"); e != nil || ok {
		t.Fatal("unknown workload accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := s.HasMeasuredWorkload(ctx, rev, "anything"); e != context.Canceled {
		t.Fatal("ignored canceled lookup")
	}
}
