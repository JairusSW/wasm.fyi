package api

type CacheStats struct {
	Kind           string `json:"kind"`
	Entries        int    `json:"entries"`
	AccountedBytes int    `json:"accountedBytes"`
	EntryLimit     int    `json:"entryLimit"`
	ByteLimit      int    `json:"byteLimit"`
	Hits           uint64 `json:"hits"`
	Misses         uint64 `json:"misses"`
	Rejected       uint64 `json:"rejected"`
	Evictions      uint64 `json:"evictions"`
}

func (c *resultCache) stats() CacheStats {
	out := CacheStats{Kind: "results", EntryLimit: resultCacheEntries, ByteLimit: resultCacheBytes}
	if c == nil {
		return out
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	out.Entries = len(c.entries)
	out.AccountedBytes = c.bytes
	out.Hits = c.hits
	out.Misses = c.misses
	out.Rejected = c.rejected
	out.Evictions = c.evictions
	return out
}
func (c *cohortCache) stats() CacheStats {
	out := CacheStats{Kind: "cohorts", EntryLimit: 16, ByteLimit: cohortCacheBytes}
	if c == nil {
		return out
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	out.Entries = len(c.entries)
	out.AccountedBytes = c.bytes
	out.Hits = c.hits
	out.Misses = c.misses
	out.Rejected = c.rejected
	out.Evictions = c.evictions
	return out
}
