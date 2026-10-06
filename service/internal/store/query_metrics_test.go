package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestUnmatchedResultDataStillConsumesQueryBudget(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := Revision{}
	summary, _ := json.Marshal(map[string]any{"value": 1, "padding": strings.Repeat("x", 200*1024)})
	// A synthetic legacy revision has no dimension index. Every individual record
	// fits the transport ceiling, but filtering cannot erase the cost of reading it.
	for i := 0; i < 180; i++ {
		v := wire.Result{Workload: fmt.Sprintf("fixture/%d", i), ContractID: wire.Hash([]byte(fmt.Sprint(i))), Metric: "included", Created: time.Now().UTC(), Summary: summary}
		data, _ := wire.Encode(v)
		record := wire.Record{Kind: "result", ID: wire.Hash(data), Data: data}
		digest, e := s.put(record)
		if e != nil {
			t.Fatal(e)
		}
		rev.Catalog, e = s.mapSet(rev.Catalog, "result:"+record.ID, digest, 0)
		if e != nil {
			t.Fatal(e)
		}
		selection, e := s.put(cell{Current: record.ID})
		if e != nil {
			t.Fatal(e)
		}
		rev.Selection, e = s.mapSet(rev.Selection, v.Cell(), selection, 0)
		if e != nil {
			t.Fatal(e)
		}
	}
	id := wire.Hash([]byte("synthetic-large-legacy-query"))
	s.published[id] = rev
	rows, e := s.ResultsContext(context.Background(), Query{Revision: id, Metric: "excluded"}, false)
	if !errors.Is(e, ErrLimit) || rows != nil {
		t.Fatal("unmatched data bypassed serving budget", e, len(rows))
	}
	stats := s.resultQueryStats()[0]
	if stats.Failed != 1 || stats.Queries != 1 || stats.Matched != 0 || stats.Records >= 180 || stats.ResultDataBytes <= 32<<20 || stats.ResultDataBytes > (32<<20)+wire.ChunkBytes {
		t.Fatal("partial work missing or unbounded", stats)
	}
}
func TestResultQueryWorkSeparatesHistoryAndFailures(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev := publishTest(t, s, "query-work", time.Now().UTC())
	rows, e := s.ResultsContext(context.Background(), Query{Revision: rev}, false)
	if e != nil {
		t.Fatal(e)
	}
	current := s.resultQueryStats()[0]
	if current.Queries != 1 || current.Records != uint64(len(rows)) || current.Matched != uint64(len(rows)) || current.ResultDataBytes == 0 || current.BudgetUnits < current.Records {
		t.Fatal(current)
	}
	_, e = s.ResultsContext(context.Background(), Query{Revision: rev}, true)
	if e != nil {
		t.Fatal(e)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	_, e = s.ResultsContext(canceled, Query{Revision: rev}, true)
	if !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	history := s.resultQueryStats()[1]
	if history.Queries != 2 || history.Failed != 1 || history.Records != uint64(len(rows)) {
		t.Fatal(history)
	}
}
