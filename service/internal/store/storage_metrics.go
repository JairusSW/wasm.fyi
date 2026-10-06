package store

import (
	"sync"
	"time"

	"github.com/cockroachdb/pebble/v2"
)

type FilesystemSpace struct {
	Status         string  `json:"status"`
	AvailableBytes *uint64 `json:"availableBytes"`
	TotalBytes     *uint64 `json:"totalBytes"`
}

func filesystemSpace(path string) FilesystemSpace {
	available, total, e := filesystemBytes(path)
	if e != nil {
		return FilesystemSpace{Status: "unavailable"}
	}
	return FilesystemSpace{Status: "available", AvailableBytes: &available, TotalBytes: &total}
}

type WriteStallStats struct {
	Version    string `json:"version"`
	Active     uint64 `json:"active"`
	Count      uint64 `json:"count"`
	DurationNS uint64 `json:"durationNs"`
	Memtable   uint64 `json:"memtable"`
	Level0     uint64 `json:"level0"`
	Other      uint64 `json:"other"`
}
type writeStallMetrics struct {
	mu                                               sync.Mutex
	last                                             time.Time
	active, count, duration, memtable, level0, other uint64
}

func (m *writeStallMetrics) advance(now time.Time) {
	if !m.last.IsZero() && now.After(m.last) {
		m.duration += uint64(now.Sub(m.last)) * m.active
	}
	m.last = now
}
func (m *writeStallMetrics) begin(reason string, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.advance(now)
	m.active++
	m.count++
	switch reason {
	case "memtable count limit reached":
		m.memtable++
	case "L0 file count limit exceeded":
		m.level0++
	default:
		m.other++
	}
}
func (m *writeStallMetrics) end(now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.advance(now)
	if m.active > 0 {
		m.active--
	}
}
func (m *writeStallMetrics) snapshot(now time.Time) WriteStallStats {
	out := WriteStallStats{Version: "pebble-write-stalls-v1"}
	if m == nil {
		return out
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	duration := m.duration
	if !m.last.IsZero() && now.After(m.last) {
		duration += uint64(now.Sub(m.last)) * m.active
	}
	out.Active = m.active
	out.Count = m.count
	out.DurationNS = duration
	out.Memtable = m.memtable
	out.Level0 = m.level0
	out.Other = m.other
	return out
}
func (m *writeStallMetrics) listener() *pebble.EventListener {
	return &pebble.EventListener{WriteStallBegin: func(info pebble.WriteStallBeginInfo) { m.begin(info.Reason, time.Now()) }, WriteStallEnd: func() { m.end(time.Now()) }}
}
