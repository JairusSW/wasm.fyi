package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const cohortCacheBytes = 32 << 20

type cohortCache struct {
	hits, misses, rejected, evictions uint64
	mu                                sync.Mutex
	entries                           map[string]*store.Cohort
	order                             []string
	bytes                             int
	sizes                             map[string]int
}

func (c *cohortCache) get(key string) *store.Cohort {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry := c.entries[key]
	if entry != nil {
		c.hits++
	} else {
		c.misses++
	}
	return entry
}
func (c *cohortCache) put(key string, v *store.Cohort) {
	b, e := wire.Encode(v)
	// Charge a conservative representation/structure estimate rather than just
	// the wire size; member structs and slice capacity also retain memory.
	cost := 2 * len(b)
	for _, p := range v.Comparison.Populations {
		cost += len(p.Members) * 256
	}
	if e != nil || cost > cohortCacheBytes {
		c.mu.Lock()
		c.rejected++
		c.mu.Unlock()
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries[key] != nil {
		return
	}
	if c.sizes == nil {
		c.sizes = map[string]int{}
	}
	for len(c.order) >= 16 || c.bytes+cost > cohortCacheBytes {
		c.evictions++
		old := c.order[0]
		c.order = c.order[1:]
		c.bytes -= c.sizes[old]
		delete(c.sizes, old)
		delete(c.entries, old)
	}
	c.entries[key] = v
	c.sizes[key] = cost
	c.bytes += cost
	c.order = append(c.order, key)
}

type cohortCapsule struct {
	Version  string            `json:"version"`
	Category string            `json:"category"`
	Scope    store.CohortScope `json:"scope"`
}

func (a *API) signCohort(scope store.CohortScope) (string, error) {
	b, e := wire.Encode(cohortCapsule{comparison.Version, comparison.CategoryVersion, scope})
	if e != nil || len(b) > 8192 {
		return "", wire.Invalid("cohort scope exceeds ceiling")
	}
	mac := hmac.New(sha256.New, a.CursorKey)
	mac.Write([]byte("cohort-v1:"))
	mac.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
func (a *API) decodeCohort(token string) (store.CohortScope, error) {
	var capsule cohortCapsule
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(token) > 16384 {
		return capsule.Scope, wire.Invalid("invalid cohort identity")
	}
	b, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil || len(b) > 8192 {
		return capsule.Scope, wire.Invalid("invalid cohort identity")
	}
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return capsule.Scope, wire.Invalid("invalid cohort identity")
	}
	mac := hmac.New(sha256.New, a.CursorKey)
	mac.Write([]byte("cohort-v1:"))
	mac.Write(b)
	if !hmac.Equal(sig, mac.Sum(nil)) || wire.Decode(b, &capsule) != nil || capsule.Version != comparison.Version || capsule.Category != comparison.CategoryVersion {
		return capsule.Scope, wire.Invalid("invalid cohort identity")
	}
	return a.Store.NormalizeCohort(capsule.Scope)
}

func (a *API) cohort(w http.ResponseWriter, r *http.Request, path string, params url.Values) {
	var scope store.CohortScope
	var token string
	var e error
	immutable := true
	if path == "aggregates" || path == "overview" {
		raw := params.Get("scope")
		if raw == "" || len(raw) > 8192 {
			problem(w, r, wire.Invalid("bounded cohort scope required"))
			return
		}
		if e = wire.Decode([]byte(raw), &scope); e != nil {
			problem(w, r, wire.Invalid("invalid cohort scope"))
			return
		}
		if params.Has("version") && params.Get("version") != comparison.Version {
			problem(w, r, wire.Invalid("unsupported comparison version"))
			return
		}
		// Dataset revision alone does not pin website analysis across upgrades.
		immutable = scope.Revision != "" && params.Get("version") == comparison.Version
		scope, e = a.Store.NormalizeCohort(scope)
		if e != nil {
			problem(w, r, e)
			return
		}
		token, e = a.signCohort(scope)
	} else {
		token = strings.TrimPrefix(path, "cohorts/")
		scope, e = a.decodeCohort(token)
	}
	if e != nil {
		problem(w, r, e)
		return
	}
	if path == "overview" {
		prepared, e := a.Store.PreparedOverview(r.Context(), scope)
		if e == nil {
			prepared.Cohort = token
			respond(w, r, 200, prepared, immutable)
			return
		}
		if e != store.ErrNotFound {
			problem(w, r, e)
			return
		}
	}
	keyBytes, _ := wire.Encode(cohortCapsule{comparison.Version, comparison.CategoryVersion, scope})
	key := wire.Hash(keyBytes)
	c := a.cohorts.get(key)
	if c == nil {
		select {
		case a.calculating <- struct{}{}:
			defer func() { <-a.calculating }()
		default:
			respond(w, r, 429, map[string]string{"error": "cohort computation concurrency limit"}, false)
			return
		}
		computed, e := a.Store.ComputeCohort(r.Context(), scope)
		if e != nil {
			problem(w, r, e)
			return
		}
		c = &computed
		a.cohorts.put(key, c)
	}
	if e = r.Context().Err(); e != nil {
		problem(w, r, e)
		return
	}
	if path == "overview" {
		a.overview(w, r, c, token, immutable)
		return
	}
	if path == "aggregates" {
		output := c.Comparison
		output.Populations = append([]comparison.Population{}, output.Populations...)
		reportCounts, configurationCounts := map[string]int{}, map[string]int{}
		for i := range output.Populations {
			p := &output.Populations[i]
			reportCounts[p.Configuration] = len(p.Reports)
			configs := map[string]bool{}
			for _, m := range p.Members {
				configs[m.Cell.ExactConfiguration] = true
			}
			configurationCounts[p.Configuration] = len(configs)
			p.Members = nil
			p.Reports = nil
		}
		respond(w, r, 200, map[string]any{"scope": scope, "cohort": token, "digest": c.Digest, "categoryPolicy": c.CategoryPolicy, "eligibilityPolicy": c.EligibilityPolicy, "excluded": c.Excluded, "comparison": output, "reportCounts": reportCounts, "configurationCounts": configurationCounts}, immutable)
		return
	}
	n, e := limit(r)
	if e != nil {
		problem(w, r, e)
		return
	}
	var cur cursor
	if value := params.Get("cursor"); value != "" {
		cur, e = a.parse(value)
		if e != nil {
			problem(w, r, e)
			return
		}
	}
	lane := params.Get("lane")
	if lane != "" {
		found := false
		for _, id := range scope.Lanes {
			if id == lane {
				found = true
			}
		}
		if !found {
			problem(w, r, wire.Invalid("cohort lane not requested"))
			return
		}
	}
	query := "cohort:" + key + ":" + lane + ":" + strconv.Itoa(n)
	if cur.Revision != "" && (cur.Revision != scope.Revision || cur.Query != query) {
		problem(w, r, wire.Invalid("cursor scope differs"))
		return
	}
	// Slice references directly: never serialize or decode an entire membership
	// inventory merely to return one page. Totals refer to the full computation.
	total := 0
	for _, p := range c.Comparison.Populations {
		if lane == "" || p.Configuration == lane {
			total += len(p.Members)
		}
	}
	if cur.Offset > total {
		problem(w, r, wire.Invalid("cursor offset invalid"))
		return
	}
	items := []comparison.Member{}
	position := 0
	size := 4096
members:
	for _, p := range c.Comparison.Populations {
		if lane != "" && p.Configuration != lane {
			continue
		}
		for _, member := range p.Members {
			if e = r.Context().Err(); e != nil {
				problem(w, r, e)
				return
			}
			if position < cur.Offset {
				position++
				continue
			}
			b, _ := wire.Encode(member)
			if len(items) >= n || size+len(b)+1 > wire.ResponseBytes {
				break members
			}
			items = append(items, member)
			size += len(b) + 1
			position++
		}
	}
	if len(items) == 0 && cur.Offset < total {
		problem(w, r, store.ErrLimit)
		return
	}
	next := ""
	end := cur.Offset + len(items)
	if end < total {
		next = a.sign(cursor{scope.Revision, query, end})
	}
	respond(w, r, 200, map[string]any{"revision": scope.Revision, "digest": c.Digest, "items": items, "total": total, "complete": end == total, "nextCursor": next}, true)
}
