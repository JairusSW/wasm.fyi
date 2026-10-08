// Package benchdb stores current benchmark measurements without evidence or reports.
package benchdb

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

var ErrChanged = errors.New("capture revision changed")
var ErrNotFound = errors.New("platform not found")

type Store struct {
	db        *pebble.DB
	cursorKey []byte
	write     sync.Mutex
}
type engine struct {
	ID      string
	Version string
	Backend string
}
type contract struct {
	Workload string
	Wasm     string
	Artifact string
}
type measurement struct {
	Source        *Source   `json:"o,omitempty"`
	Display       *Display  `json:"d,omitempty"`
	TimingSamples int       `json:"n,omitempty"`
	SamplesNs     []float64 `json:"sn,omitempty"`
	Contract      string    `json:"c"`
	Engine        string    `json:"e"`
	CapturedAt    string    `json:"t"`
	Status        string    `json:"s"`
	Latency       *float64  `json:"l"`
	PeakRSS       *float64  `json:"m,omitempty"`
	Code          *float64  `json:"b,omitempty"`
	CodeKind      *string   `json:"k,omitempty"`
	MemoryStatus  string    `json:"ms,omitempty"`
	CodeStatus    string    `json:"cs,omitempty"`
}
type PlatformChoice struct {
	ID string `json:"id"`
	Platform
}
type Catalog struct {
	Revision string           `json:"revision"`
	Items    []PlatformChoice `json:"items"`
}
type Page struct {
	Revision   string   `json:"revision"`
	Platform   string   `json:"platform"`
	Phase      string   `json:"phase"`
	Items      []Result `json:"items"`
	Total      int      `json:"total"`
	NextCursor *string  `json:"nextCursor"`
}
type Query struct {
	History  bool
	Platform string
	Phase    string
	Cursor   string
	Limit    int
}
type pageCursor struct {
	Revision string `json:"revision"`
	Platform string `json:"platform"`
	Phase    string `json:"phase"`
	After    string `json:"after"`
}

func Open(directory string) (*Store, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	cache := pebble.NewCache(8 << 20)
	defer cache.Unref()
	db, err := pebble.Open(filepath.Join(directory, "benchmarks"), &pebble.Options{Cache: cache, MemTableSize: 4 << 20, MaxOpenFiles: 64})
	if err != nil {
		return nil, err
	}
	s := &Store{db: db}
	version, err := get(db, "meta/schema")
	if errors.Is(err, pebble.ErrNotFound) {
		b := db.NewBatch()
		defer b.Close()
		_ = b.Set([]byte("meta/schema"), []byte("1"), nil)
		seed := wire.Hash([]byte(strconv.FormatInt(time.Now().UnixNano(), 10)))
		_ = b.Set([]byte("meta/revision"), []byte(seed), nil)
		err = b.Commit(pebble.Sync)
	} else if err == nil && string(version) != "1" {
		err = fmt.Errorf("unsupported benchmark database schema %s", version)
	}
	if err != nil {
		db.Close()
		return nil, err
	}
	key, err := get(db, "meta/cursor-key")
	if errors.Is(err, pebble.ErrNotFound) {
		key = make([]byte, 32)
		if _, err = rand.Read(key); err == nil {
			err = db.Set([]byte("meta/cursor-key"), key, pebble.Sync)
		}
	}
	if err != nil || len(key) != 32 {
		db.Close()
		return nil, fmt.Errorf("invalid cursor key: %v", err)
	}
	s.cursorKey = key
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }

// Pebble returns borrowed values; copy before releasing their lifetime.
func get(db interface {
	Get([]byte) ([]byte, io.Closer, error)
}, key string) ([]byte, error) {
	v, c, e := db.Get([]byte(key))
	if e != nil {
		return nil, e
	}
	defer c.Close()
	return bytes.Clone(v), nil
}
func encode(v any) []byte     { b, _ := json.Marshal(v); return b }
func identifier(v any) string { return wire.Hash(encode(v)) }
func count(db interface {
	Get([]byte) ([]byte, io.Closer, error)
}, key string) (int, error) {
	v, e := get(db, key)
	if errors.Is(e, pebble.ErrNotFound) {
		return 0, nil
	}
	if e != nil {
		return 0, e
	}
	n, e := strconv.Atoi(string(v))
	return n, e
}
func setCount(b *pebble.Batch, key string, n int) error {
	return b.Set([]byte(key), []byte(strconv.Itoa(n)), nil)
}
func adjustReference(b *pebble.Batch, kind, id string, delta int) error {
	key := "refs/" + kind + "/" + id
	n, e := count(b, key)
	if e != nil {
		return e
	}
	n += delta
	if n < 0 {
		return fmt.Errorf("invalid reference count")
	}
	if n == 0 {
		if e = b.Delete([]byte(kind+"/"+id), nil); e != nil {
			return e
		}
		return b.Delete([]byte(key), nil)
	}
	return setCount(b, key, n)
}

// Known source snapshots outrank installed builds whose source age is unknown.
func qualifiedSource(source *Source) bool {
	if source == nil {
		return false
	}
	if source.Kind != "current" {
		return true
	}
	revision := strings.SplitN(source.Revision, "/", 2)[0]
	if len(revision) != 40 {
		return false
	}
	for _, c := range strings.ToLower(revision) {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// Put atomically replaces newer cells, deduplicates metadata and ignores old retries.
func (s *Store) Put(ctx context.Context, c Capture) (string, error) {
	if e := Validate(c); e != nil {
		return "", e
	}
	s.write.Lock()
	defer s.write.Unlock()
	if e := ctx.Err(); e != nil {
		return "", e
	}
	platform := identifier(c.Platform)
	keys := make([]string, 0, len(c.Results))
	for _, r := range c.Results {
		keys = append(keys, r.Workload+"|"+r.Engine+"|"+r.Phase)
	}
	sort.Strings(keys)
	p := c.Platform
	scope := []any{p.OS, p.Arch, p.CPU, p.Cores, p.Kernel, p.MemoryBytes}
	for _, k := range keys {
		scope = append(scope, k)
	}
	id := identifier(scope)
	b := s.db.NewIndexedBatch()
	defer b.Close()
	rows, e := count(b, "meta/rows")
	if e != nil {
		return "", e
	}
	changed := false
	for _, r := range c.Results {
		if e = ctx.Err(); e != nil {
			return "", e
		}
		if r.Source == nil {
			r.Source = c.Source
		}
		cfg := engine{r.Engine, r.Version, r.Backend}
		cfgID := identifier(cfg)
		value := measurement{Source: r.Source, Display: r.Display, TimingSamples: r.TimingSamples, SamplesNs: r.SamplesNs, Contract: r.Contract, Engine: cfgID, CapturedAt: c.CapturedAt, Status: r.Status, Latency: r.Value, PeakRSS: r.PeakRSS, Code: r.CodeBytes, CodeKind: r.CodeKind, MemoryStatus: r.MemoryStatus, CodeStatus: r.CodeStatus}
		recipeCheck := contract{r.Workload, r.Wasm, r.Artifact}
		if prior, err := get(b, "contracts/"+r.Contract); err == nil {
			if !bytes.Equal(prior, encode(recipeCheck)) {
				return "", wire.Invalid("contract identity has conflicting metadata")
			}
		} else if !errors.Is(err, pebble.ErrNotFound) {
			return "", err
		}
		if r.Source != nil {
			archiveKey := "history/" + platform + "/" + r.Phase + "/" + r.Source.AsOf + "\x00" + r.Workload + "\x00" + cfgID
			prior, err := get(b, archiveKey)
			var previous measurement
			if err == nil {
				if e = json.Unmarshal(prior, &previous); e != nil {
					return "", e
				}
			} else if !errors.Is(err, pebble.ErrNotFound) {
				return "", err
			}
			if previous.CapturedAt == "" || later(c.CapturedAt, previous.CapturedAt) {
				if previous.CapturedAt == "" {
					rows++
					n, err := count(b, "historycount/"+platform+"/"+r.Phase)
					if err != nil {
						return "", err
					}
					if e = setCount(b, "historycount/"+platform+"/"+r.Phase, n+1); e != nil {
						return "", e
					}
				}
				if previous.Contract != r.Contract {
					if previous.Contract != "" {
						if e = adjustReference(b, "contracts", previous.Contract, -1); e != nil {
							return "", e
						}
					}
					if e = adjustReference(b, "contracts", r.Contract, 1); e != nil {
						return "", e
					}
				}
				if previous.Engine != cfgID {
					if e = adjustReference(b, "engines", cfgID, 1); e != nil {
						return "", e
					}
				}
				recipe := contract{r.Workload, r.Wasm, r.Artifact}
				if e = b.Set([]byte("contracts/"+r.Contract), encode(recipe), nil); e != nil {
					return "", e
				}
				if e = b.Set([]byte("engines/"+cfgID), encode(cfg), nil); e != nil {
					return "", e
				}
				if e = b.Set([]byte(archiveKey), encode(value), nil); e != nil {
					return "", e
				}
				changed = true
			}
		}
		prefix := "rows/" + platform + "/" + r.Phase + "/"
		key := prefix + r.Workload + "\x00" + r.Engine
		oldBytes, err := get(b, key)
		var old measurement
		if err == nil {
			if err = json.Unmarshal(oldBytes, &old); err != nil {
				return "", err
			}
			oldTime, err := time.Parse(time.RFC3339Nano, old.CapturedAt)
			if err != nil {
				return "", err
			}
			sourceAhead := false
			if r.Source != nil && old.Source != nil {
				incomingQualified, priorQualified := qualifiedSource(r.Source), qualifiedSource(old.Source)
				if incomingQualified != priorQualified {
					if !incomingQualified {
						continue
					}
					sourceAhead = true
				} else if r.Source.AsOf != old.Source.AsOf {
					if !later(r.Source.AsOf, old.Source.AsOf) {
						continue
					}
					sourceAhead = true
				}
			}
			newTime, _ := time.Parse(time.RFC3339Nano, c.CapturedAt)
			if !sourceAhead && !newTime.After(oldTime) {
				if !newTime.Equal(oldTime) || (old.Source != nil || r.Source == nil) && (old.Display != nil || r.Display == nil) {
					continue
				}
				// Adding catalog/source metadata never changes a previously captured value.
				value.Status = old.Status
				value.Latency = old.Latency
				value.PeakRSS = old.PeakRSS
				value.Code = old.Code
				value.CodeKind = old.CodeKind
				value.MemoryStatus = old.MemoryStatus
				value.CodeStatus = old.CodeStatus
			}
		} else if !errors.Is(err, pebble.ErrNotFound) {
			return "", err
		} else {
			rows++
			n, err := count(b, "count/"+platform+"/"+r.Phase)
			if err != nil {
				return "", err
			}
			if err = setCount(b, "count/"+platform+"/"+r.Phase, n+1); err != nil {
				return "", err
			}
		}
		recipe := contract{r.Workload, r.Wasm, r.Artifact}
		if previous, err := get(b, "contracts/"+r.Contract); err == nil {
			if !bytes.Equal(previous, encode(recipe)) {
				return "", wire.Invalid("contract identity has conflicting metadata")
			}
		} else if !errors.Is(err, pebble.ErrNotFound) {
			return "", err
		}

		if old.Contract != r.Contract {
			if old.Contract != "" {
				if e = adjustReference(b, "contracts", old.Contract, -1); e != nil {
					return "", e
				}
			}
			if e = adjustReference(b, "contracts", r.Contract, 1); e != nil {
				return "", e
			}
		}
		if old.Engine != cfgID {
			if old.Engine != "" {
				if e = adjustReference(b, "engines", old.Engine, -1); e != nil {
					return "", e
				}
			}
			if e = adjustReference(b, "engines", cfgID, 1); e != nil {
				return "", e
			}
		}
		if e = b.Set([]byte("contracts/"+r.Contract), encode(recipe), nil); e != nil {
			return "", e
		}
		if e = b.Set([]byte("engines/"+cfgID), encode(cfg), nil); e != nil {
			return "", e
		}
		if e = b.Set([]byte(key), encode(value), nil); e != nil {
			return "", e
		}
		changed = true
	}
	if !changed {
		return id, nil
	}
	if rows > 5000000 {
		return "", wire.Invalid("benchmark row limit exceeded")
	}
	if _, err := get(b, "platforms/"+platform); errors.Is(err, pebble.ErrNotFound) {
		n, err := count(b, "meta/platforms")
		if err != nil {
			return "", err
		}
		if n >= 128 {
			return "", wire.Invalid("platform limit exceeded")
		}
		if err = setCount(b, "meta/platforms", n+1); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	}
	if e = b.Set([]byte("platforms/"+platform), encode(c.Platform), nil); e != nil {
		return "", e
	}
	if e = setCount(b, "meta/rows", rows); e != nil {
		return "", e
	}
	revision, e := get(b, "meta/revision")
	if e != nil {
		return "", e
	}
	captureBytes := encode(c)
	next := wire.Hash(append(revision, captureBytes...))
	platformRevision, err := get(b, "revision/"+platform)
	if errors.Is(err, pebble.ErrNotFound) {
		platformRevision = []byte(platform)
	} else if err != nil {
		return "", err
	}
	if e = b.Set([]byte("revision/"+platform), []byte(wire.Hash(append(platformRevision, captureBytes...))), nil); e != nil {
		return "", e
	}
	if e = b.Set([]byte("meta/revision"), []byte(next), nil); e != nil {
		return "", e
	}
	if e = ctx.Err(); e != nil {
		return "", e
	}
	return id, b.Commit(pebble.Sync)
}
func prefixEnd(prefix string) []byte { p := []byte(prefix); p[len(p)-1]++; return p }

func (s *Store) cursor(c pageCursor) string {
	b := encode(c)
	mac := hmac.New(sha256.New, s.cursorKey)
	mac.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Store) parseCursor(token string) (pageCursor, error) {
	var c pageCursor
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(token) > 4096 {
		return c, wire.Invalid("invalid cursor")
	}
	b, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return c, wire.Invalid("invalid cursor")
	}
	signature, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return c, wire.Invalid("invalid cursor")
	}
	mac := hmac.New(sha256.New, s.cursorKey)
	mac.Write(b)
	if !hmac.Equal(mac.Sum(nil), signature) {
		return c, wire.Invalid("invalid cursor")
	}
	if e = wire.Decode(b, &c); e != nil || !wire.IsHash(c.Revision) || !wire.IsHash(c.Platform) || !ValidPhase(c.Phase) || c.After == "" {
		return c, wire.Invalid("invalid cursor")
	}
	return c, nil
}
func (s *Store) Platforms(ctx context.Context) (Catalog, error) {
	out := Catalog{Items: []PlatformChoice{}}
	if e := ctx.Err(); e != nil {
		return out, e
	}
	snap := s.db.NewSnapshot()
	defer snap.Close()
	revision, e := get(snap, "meta/revision")
	if e != nil {
		return out, e
	}
	out.Revision = string(revision)
	iter, e := snap.NewIter(&pebble.IterOptions{LowerBound: []byte("platforms/"), UpperBound: prefixEnd("platforms/")})
	if e != nil {
		return out, e
	}
	defer iter.Close()
	for iter.First(); iter.Valid(); iter.Next() {
		if e = ctx.Err(); e != nil {
			return out, e
		}
		var p Platform
		if e = json.Unmarshal(iter.Value(), &p); e != nil {
			return out, e
		}
		out.Items = append(out.Items, PlatformChoice{strings.TrimPrefix(string(iter.Key()), "platforms/"), p})
	}
	return out, iter.Error()
}

// Page seeks directly after the last emitted row in one MVCC snapshot.
func (s *Store) Page(ctx context.Context, q Query) (Page, error) {
	page := Page{Items: []Result{}}
	if e := ctx.Err(); e != nil {
		return page, e
	}
	var cursor pageCursor
	if q.Cursor != "" {
		var e error
		cursor, e = s.parseCursor(q.Cursor)
		if e != nil {
			return page, e
		}
		if q.Platform != "" && q.Platform != cursor.Platform || q.Phase != "" && q.Phase != cursor.Phase {
			return page, wire.Invalid("cursor scope differs from query")
		}
		q.Platform = cursor.Platform
		q.Phase = cursor.Phase
	}
	if q.Phase == "" {
		q.Phase = "steady"
	}
	if !wire.IsHash(q.Platform) || !ValidPhase(q.Phase) || q.Limit < 1 || q.Limit > 1000 {
		return page, wire.Invalid("platform and valid phase/page size required")
	}
	page.Platform = q.Platform
	page.Phase = q.Phase
	snap := s.db.NewSnapshot()
	defer snap.Close()
	revision, e := get(snap, "revision/"+q.Platform)
	if errors.Is(e, pebble.ErrNotFound) {
		if _, err := get(snap, "platforms/"+q.Platform); errors.Is(err, pebble.ErrNotFound) {
			return page, ErrNotFound
		} else if err != nil {
			return page, err
		}
		revision, e = []byte(wire.Hash([]byte(q.Platform))), nil
	}
	if e != nil {
		return page, e
	}
	page.Revision = string(revision)
	if cursor.Revision != "" && cursor.Revision != page.Revision {
		return page, ErrChanged
	}
	if _, e = get(snap, "platforms/"+q.Platform); errors.Is(e, pebble.ErrNotFound) {
		return page, ErrNotFound
	} else if e != nil {
		return page, e
	}
	countPrefix, rowPrefix := "count/", "rows/"
	if q.History {
		countPrefix, rowPrefix = "historycount/", "history/"
	}
	page.Total, e = count(snap, countPrefix+q.Platform+"/"+q.Phase)
	if e != nil {
		return page, e
	}
	prefix := rowPrefix + q.Platform + "/" + q.Phase + "/"
	if cursor.After != "" && !strings.HasPrefix(cursor.After, prefix) {
		return page, wire.Invalid("invalid cursor scope")
	}
	iter, e := snap.NewIter(&pebble.IterOptions{LowerBound: []byte(prefix), UpperBound: prefixEnd(prefix)})
	if e != nil {
		return page, e
	}
	defer iter.Close()
	valid := iter.First()
	if cursor.After != "" {
		valid = iter.SeekGE([]byte(cursor.After))
		if valid && string(iter.Key()) == cursor.After {
			valid = iter.Next()
		}
	}
	recipes := map[string]contract{}
	engines := map[string]engine{}
	last := ""
	responseBytes := 0
	for ; valid && len(page.Items) < q.Limit; valid = iter.Next() {
		if e = ctx.Err(); e != nil {
			return page, e
		}
		var m measurement
		if e = json.Unmarshal(iter.Value(), &m); e != nil {
			return page, e
		}
		recipe, ok := recipes[m.Contract]
		if !ok {
			v, e := get(snap, "contracts/"+m.Contract)
			if e != nil {
				return page, e
			}
			if e = json.Unmarshal(v, &recipe); e != nil {
				return page, e
			}
			recipes[m.Contract] = recipe
		}
		cfg, ok := engines[m.Engine]
		if !ok {
			v, e := get(snap, "engines/"+m.Engine)
			if e != nil {
				return page, e
			}
			if e = json.Unmarshal(v, &cfg); e != nil {
				return page, e
			}
			engines[m.Engine] = cfg
		}
		if m.CodeKind == nil && m.CodeStatus == "ok" {
			kind := "unknown"
			m.CodeKind = &kind
		}
		item := Result{Row: Row{Source: m.Source, Display: m.Display, TimingSamples: m.TimingSamples, SamplesNs: m.SamplesNs, Workload: recipe.Workload, Wasm: recipe.Wasm, Artifact: recipe.Artifact, Contract: m.Contract, Engine: cfg.ID, Version: cfg.Version, Backend: cfg.Backend, Phase: q.Phase, Status: m.Status, Value: m.Latency, PeakRSS: m.PeakRSS, CodeBytes: m.Code, CodeKind: m.CodeKind, MemoryStatus: m.MemoryStatus, CodeStatus: m.CodeStatus}, CapturedAt: m.CapturedAt}
		itemBytes := len(encode(item)) + 1
		// Reserve space for page metadata and the signed continuation cursor.
		if len(page.Items) > 0 && responseBytes+itemBytes > wire.ResponseBytes-(32<<10) {
			break
		}
		responseBytes += itemBytes
		page.Items = append(page.Items, item)
		last = string(iter.Key())
	}
	if e = iter.Error(); e != nil {
		return page, e
	}
	if valid {
		next := s.cursor(pageCursor{page.Revision, q.Platform, q.Phase, last})
		page.NextCursor = &next
	}
	return page, nil
}

func later(a, b string) bool {
	x, e := time.Parse(time.RFC3339Nano, a)
	if e != nil {
		return false
	}
	y, e := time.Parse(time.RFC3339Nano, b)
	return e == nil && x.After(y)
}
