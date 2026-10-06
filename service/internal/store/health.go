package store

import "time"

type Health struct {
	Ready            bool   `json:"ready"`
	DatasetAvailable bool   `json:"datasetAvailable"`
	Revision         string `json:"revision"`
	RestartRequired  bool   `json:"restartRequired"`
}

func (s *Store) Health() Health {
	revision := s.Current()
	restart := s.poisoned.Load()
	return Health{Ready: !restart, DatasetAvailable: revision != "", Revision: revision, RestartRequired: restart}
}

type Stats struct {
	Health            Health          `json:"health"`
	PendingJobs       int             `json:"pendingJobs"`
	PendingBytes      int64           `json:"pendingBytes"`
	ContentBytes      int64           `json:"contentBytes"`
	ContentLimit      int64           `json:"contentLimitBytes"`
	DatabaseBytes     uint64          `json:"databaseBytes"`
	CompactionDebt    uint64          `json:"compactionDebtBytes"`
	CompactionsActive int64           `json:"compactionsActive"`
	Filesystem        FilesystemSpace `json:"filesystem"`
	WriteStalls       WriteStallStats `json:"writeStalls"`
	Collected         time.Time       `json:"collectedAt"`
}

func (s *Store) Stats() (Stats, error) {
	q, e := s.quota()
	if e != nil {
		return Stats{}, e
	}
	s.contentMu.Lock()
	size := s.contentBytes
	s.contentMu.Unlock()
	metrics := s.db.Metrics()
	return Stats{Filesystem: filesystemSpace(s.root), WriteStalls: s.stalls.snapshot(time.Now()), Health: s.Health(), PendingJobs: q.Jobs, PendingBytes: q.Bytes, ContentBytes: size, ContentLimit: s.limits.ContentBytes, DatabaseBytes: metrics.DiskSpaceUsage(), CompactionDebt: metrics.Compact.EstimatedDebt, CompactionsActive: metrics.Compact.NumInProgress, Collected: time.Now().UTC()}, nil
}
