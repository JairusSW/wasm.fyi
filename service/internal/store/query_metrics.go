package store

import "sync/atomic"

type queryCounters struct{ queries, failed, budgetUnits, records, dataBytes, matched atomic.Uint64 }
type ResultQueryStats struct {
	Scope           string `json:"scope"`
	Queries         uint64 `json:"queries"`
	Failed          uint64 `json:"failed"`
	BudgetUnits     uint64 `json:"budgetUnits"`
	Records         uint64 `json:"records"`
	ResultDataBytes uint64 `json:"resultDataBytes"`
	Matched         uint64 `json:"matched"`
}

func (c *queryCounters) snapshot(scope string) ResultQueryStats {
	return ResultQueryStats{Scope: scope, Queries: c.queries.Load(), Failed: c.failed.Load(), BudgetUnits: c.budgetUnits.Load(), Records: c.records.Load(), ResultDataBytes: c.dataBytes.Load(), Matched: c.matched.Load()}
}
func (s *Store) resultQueryStats() []ResultQueryStats {
	return []ResultQueryStats{s.queryWork[0].snapshot("selection"), s.queryWork[1].snapshot("history")}
}
