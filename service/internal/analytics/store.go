package analytics

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"log"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const schema = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
PRAGMA auto_vacuum=INCREMENTAL;
CREATE TABLE IF NOT EXISTS dimensions(id INTEGER PRIMARY KEY,kind INTEGER NOT NULL,label TEXT NOT NULL,extra TEXT NOT NULL DEFAULT '',lat REAL NOT NULL DEFAULT 0,lon REAL NOT NULL DEFAULT 0,last INTEGER NOT NULL DEFAULT 0,UNIQUE(kind,label,extra,lat,lon));
CREATE INDEX IF NOT EXISTS dimension_expiry ON dimensions(last);
CREATE TABLE IF NOT EXISTS events(at INTEGER NOT NULL,status INTEGER NOT NULL,method INTEGER NOT NULL,path INTEGER NOT NULL,origin INTEGER NOT NULL,agent INTEGER NOT NULL,ms REAL NOT NULL);
CREATE INDEX IF NOT EXISTS event_time ON events(at DESC);
CREATE TABLE IF NOT EXISTS buckets(g INTEGER NOT NULL,t INTEGER NOT NULL,v INTEGER NOT NULL DEFAULT 0,p INTEGER NOT NULL DEFAULT 0,a0 INTEGER NOT NULL DEFAULT 0,a1 INTEGER NOT NULL DEFAULT 0,a2 INTEGER NOT NULL DEFAULT 0,err INTEGER NOT NULL DEFAULT 0,down INTEGER NOT NULL DEFAULT 0,up INTEGER NOT NULL DEFAULT 0,adown INTEGER NOT NULL DEFAULT 0,aup INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(g,t)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS facts(g INTEGER NOT NULL,t INTEGER NOT NULL,d INTEGER NOT NULL,o INTEGER NOT NULL,n INTEGER NOT NULL,e INTEGER NOT NULL DEFAULT 0,last INTEGER NOT NULL,h BLOB NOT NULL,PRIMARY KEY(g,t,d,o)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS fact_dimension ON facts(d,g,t);
CREATE TABLE IF NOT EXISTS client_paths(g INTEGER NOT NULL,t INTEGER NOT NULL,c INTEGER NOT NULL,p INTEGER NOT NULL,o INTEGER NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(g,t,c,p,o)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS seen(g INTEGER NOT NULL,t INTEGER NOT NULL,id BLOB NOT NULL,PRIMARY KEY(g,t,id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS place_seen(g INTEGER NOT NULL,t INTEGER NOT NULL,d INTEGER NOT NULL,id BLOB NOT NULL,PRIMARY KEY(g,t,d,id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS clients_ever(id BLOB PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS totals(id INTEGER PRIMARY KEY CHECK(id=1),since INTEGER NOT NULL,v INTEGER NOT NULL DEFAULT 0,p INTEGER NOT NULL DEFAULT 0,a0 INTEGER NOT NULL DEFAULT 0,a1 INTEGER NOT NULL DEFAULT 0,a2 INTEGER NOT NULL DEFAULT 0,down INTEGER NOT NULL DEFAULT 0,up INTEGER NOT NULL DEFAULT 0,adown INTEGER NOT NULL DEFAULT 0,aup INTEGER NOT NULL DEFAULT 0,c INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS auth_pins(alias TEXT PRIMARY KEY COLLATE NOCASE,github_id INTEGER NOT NULL UNIQUE) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS auth_revoked(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL) WITHOUT ROWID;
PRAGMA user_version=1;
`
const (
	dimPath     = 1
	dimClient   = 2
	dimPage     = 3
	dimRef      = 4
	dimCountry  = 5
	dimDevice   = 6
	dimBrowser  = 7
	dimRuntime  = 8
	dimWorkload = 9
	dimPlace    = 10
	dimAgent    = 11
)

var granules = []int64{60, 900, 3600, 86400}

type Store struct {
	db             *sql.DB
	read           *sql.DB
	geo            *geo
	verify         *verifier
	salt           Salt
	queue          chan Input
	stop           chan struct{}
	done           chan struct{}
	closing        atomic.Bool
	closeOnce      sync.Once
	dropped        atomic.Uint64
	liveMu         sync.Mutex
	rates          [60]LiveRate
	dims           map[string]int64
	cacheMu        sync.Mutex
	cache          map[string]cacheEntry
	selectionKnown func(context.Context, string, string) (bool, error)
	selections     map[string]selectionEntry
}
type selectionEntry struct {
	known bool
	until time.Time
}
type cacheEntry struct {
	until time.Time
	value any
}

func Open(directory, geoDir string) (*Store, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	path, err := filepath.Abs(filepath.Join(directory, "analytics.sqlite"))
	if err != nil {
		return nil, err
	}
	// Pre-create privately before SQLite creates its journal siblings.
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	f.Close()
	if err = os.Chmod(path, 0600); err != nil {
		return nil, err
	}
	uri := url.URL{Scheme: "file", Path: path}
	q := uri.Query()
	q.Set("_busy_timeout", "3000")
	q.Set("_foreign_keys", "on")
	q.Set("_cache_size", "-2048")
	uri.RawQuery = q.Encode()
	db, err := sql.Open("sqlite3", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.Exec("INSERT OR IGNORE INTO totals(id,since)VALUES(1,?)", time.Now().UnixMilli()); err != nil {
		db.Close()
		return nil, err
	}
	q.Set("mode", "ro")
	uri.RawQuery = q.Encode()
	reader, err := sql.Open("sqlite3", uri.String())
	if err != nil {
		db.Close()
		return nil, err
	}
	reader.SetMaxOpenConns(3)
	s := &Store{db: db, read: reader, geo: openGeo(geoDir), verify: newVerifier(), queue: make(chan Input, 2048), stop: make(chan struct{}), done: make(chan struct{}), dims: map[string]int64{}, cache: map[string]cacheEntry{}}
	go s.writer()
	return s, nil
}
func (s *Store) Close() error {
	s.closeOnce.Do(func() {
		s.closing.Store(true)
		close(s.stop)
		<-s.done
		close(s.verify.stop)
		<-s.verify.done
		s.geo.close()
		s.read.Close()
	})
	return s.db.Close()
}
func (s *Store) Identity(now time.Time, ip, agent string) []byte {
	return s.salt.Identity(now, ip, agent)
}
func (s *Store) Enqueue(in Input) {
	if s.closing.Load() {
		return
	}
	select {
	case s.queue <- in:
	default:
		s.dropped.Add(1)
	}
}
func (s *Store) Dropped() uint64 { return s.dropped.Load() }
func (s *Store) writer() {
	defer close(s.done)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	prune := time.NewTicker(time.Minute)
	defer prune.Stop()
	batch := make([]Event, 0, 256)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := s.write(batch); err != nil {
			log.Printf("analytics write failed (no request data logged): %v", err)
			s.dropped.Add(uint64(len(batch)))
		}
		batch = batch[:0]
	}
	consume := func(in Input) {
		e := in.Event
		e.Runtime = s.knownSelection("runtime", e.Runtime)
		e.Workload = s.knownSelection("workload", e.Workload)
		s.geo.enrich(&e, in.IP)
		if e.Origin == 2 && s.verify.check(in.IP, e.Agent) {
			e.Network += " (verified)"
		}
		in.IP = ""
		in.UA = ""
		s.observeLive(e)
		batch = append(batch, e)
		if len(batch) == 256 {
			flush()
		}
	}
	for {
		select {
		case in := <-s.queue:
			consume(in)
		case <-tick.C:
			flush()
		case <-prune.C:
			flush()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			if err := s.Prune(ctx, time.Now()); err != nil {
				log.Printf("analytics retention failed: %v", err)
			}
			cancel()
		case <-s.stop:
			for {
				select {
				case in := <-s.queue:
					consume(in)
				default:
					flush()
					return
				}
			}
		}
	}
}
func (s *Store) observeLive(e Event) {
	s.liveMu.Lock()
	defer s.liveMu.Unlock()
	sec := e.At.Unix()
	i := sec % 60
	if s.rates[i].At != sec*1000 {
		s.rates[i] = LiveRate{At: sec * 1000}
	}
	s.rates[i].Down += e.Down
	s.rates[i].Up += e.Up
}
func (s *Store) Live(now time.Time) Live {
	s.liveMu.Lock()
	defer s.liveMu.Unlock()
	out := Live{Rate: LiveRate{At: now.UnixMilli()}}
	sec := now.Unix() - 1
	r := s.rates[sec%60]
	if r.At == sec*1000 {
		out.Rate = r
	}
	return out
}

// Sparse histogram: varint (bucket,count) pairs, usually 2–12 bytes rather
// than a padded JSON array or 256-byte vector on every dimension/bucket.
func decodeHist(b []byte) [32]uint64 {
	var out [32]uint64
	for len(b) > 0 {
		index, n := binary.Uvarint(b)
		if n <= 0 || index >= 32 {
			return out
		}
		b = b[n:]
		count, n := binary.Uvarint(b)
		if n <= 0 {
			return out
		}
		b = b[n:]
		out[index] += count
	}
	return out
}
func encodeHist(h [32]uint64) []byte {
	b := make([]byte, 0, 16)
	for i, n := range h {
		if n > 0 {
			b = binary.AppendUvarint(b, uint64(i))
			b = binary.AppendUvarint(b, n)
		}
	}
	return b
}
func hist(ms float64) []byte {
	var h [32]uint64
	i := 0
	if ms > 0 {
		i = int(math.Ceil(math.Log2(ms*4 + 1)))
		if i > 31 {
			i = 31
		}
	}
	h[i] = 1
	return encodeHist(h)
}
func mergeHist(a, b []byte) []byte {
	left, right := decodeHist(a), decodeHist(b)
	for i := range left {
		left[i] += right[i]
	}
	return encodeHist(left)
}
func percentile(b []byte, p float64) float64 {
	h := decodeHist(b)
	var total uint64
	for _, n := range h {
		total += n
	}
	if total == 0 {
		return 0
	}
	want := uint64(math.Ceil(float64(total) * p))
	var n uint64
	for i, count := range h {
		n += count
		if n >= want {
			return (math.Pow(2, float64(i)) - 1) / 4
		}
	}
	return 0
}
func (s *Store) dimension(tx *sql.Tx, kind int, label, extra string, lat, lon float64) (int64, error) {
	label = dimensionText(label)
	extra = dimensionText(extra)
	key := fmt.Sprintf("%d\x00%s\x00%s\x00%.1f\x00%.1f", kind, label, extra, lat, lon)
	if id, ok := s.dims[key]; ok {
		return id, nil
	}
	var id int64
	err := tx.QueryRow("SELECT id FROM dimensions WHERE kind=? AND label=? AND extra=? AND lat=? AND lon=?", kind, label, extra, lat, lon).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		var count int
		if countErr := tx.QueryRow("SELECT COUNT(*) FROM dimensions WHERE kind=?", kind).Scan(&count); countErr != nil {
			return 0, countErr
		}
		if count >= 1024 {
			label = "Other"
			extra = ""
			lat = 0
			lon = 0
			key = fmt.Sprintf("%d\x00Other\x00\x000.0\x000.0", kind)
			if existing, ok := s.dims[key]; ok {
				return existing, nil
			}
			err = tx.QueryRow("SELECT id FROM dimensions WHERE kind=? AND label='Other' AND extra='' AND lat=0 AND lon=0", kind).Scan(&id)
		}
		if errors.Is(err, sql.ErrNoRows) {
			r, e := tx.Exec("INSERT INTO dimensions(kind,label,extra,lat,lon)VALUES(?,?,?,?,?)", kind, label, extra, lat, lon)
			if e != nil {
				return 0, e
			}
			id, e = r.LastInsertId()
			if e != nil {
				return 0, e
			}
		} else if err != nil {
			return 0, err
		}
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	if len(s.dims) < 8192 {
		s.dims[key] = id
	}
	return id, nil
}
func (s *Store) write(events []Event) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	failed := true
	defer func() {
		if failed {
			clear(s.dims)
		}
	}()
	seen, err := tx.Prepare("INSERT OR IGNORE INTO seen(g,t,id)VALUES(?,?,?)")
	if err != nil {
		return err
	}
	defer seen.Close()
	placeSeen, err := tx.Prepare("INSERT OR IGNORE INTO place_seen(g,t,d,id)VALUES(?,?,?,?)")
	if err != nil {
		return err
	}
	defer placeSeen.Close()
	clients, err := tx.Prepare("INSERT OR IGNORE INTO clients_ever(id)VALUES(?)")
	if err != nil {
		return err
	}
	defer clients.Close()
	raw, err := tx.Prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?)")
	if err != nil {
		return err
	}
	defer raw.Close()
	type bucketKey struct{ g, t int64 }
	type bucket struct {
		v, p                      int64
		a                         [3]int64
		err, down, up, adown, aup int64
	}
	type factKey struct {
		g, t, d int64
		o       int
	}
	type aggregate struct {
		n, e, last int64
		h          []byte
	}
	type pathKey struct {
		g, t, c, p int64
		o          int
	}
	usedDimensions := map[int64]int64{}
	paths := map[pathKey]int64{}
	buckets := map[bucketKey]*bucket{}
	facts := map[factKey]*aggregate{}
	total := bucket{}
	newClients := int64(0)
	for _, e := range events {
		at := e.At.Unix()
		api, apiBytes, pv, errorsN := int64(0), int64(0), int64(0), int64(0)
		if e.API || e.APIBytes {
			apiBytes = 1
		}
		if e.API {
			api = 1
		}
		if e.Pageview {
			pv = 1
		}
		if e.API && e.Status >= 500 {
			errorsN = 1
		}
		total.p += pv
		total.a[e.Origin] += api
		total.down += e.Down
		total.up += e.Up
		total.adown += e.Down * apiBytes
		total.aup += e.Up * apiBytes
		if e.API && e.Origin == 1 {
			network := strings.Fields(e.Network)
			asn := "Unknown"
			if len(network) > 0 && strings.HasPrefix(network[0], "AS") {
				asn = network[0]
			}
			sum := sha256.Sum256([]byte(e.Agent + "\x00" + asn))
			r, er := clients.Exec(sum[:16])
			if er != nil {
				return er
			}
			n, _ := r.RowsAffected()
			newClients += n
		}
		type dim struct {
			k            int
			label, extra string
			lat, lon     float64
		}
		dims := []dim{}
		if e.API {
			dims = append(dims, dim{dimPath, e.Path, "", 0, 0})
			if e.Origin != 0 {
				dims = append(dims, dim{dimClient, e.Agent, clientNetwork(e.Network, e.Origin), 0, 0})
			}
			if e.Runtime != "" {
				dims = append(dims, dim{dimRuntime, e.Runtime, "", 0, 0})
			}
			if e.Workload != "" {
				dims = append(dims, dim{dimWorkload, e.Workload, "", 0, 0})
			}
		}
		if e.Pageview {
			dims = append(dims, dim{dimPage, e.Path, "", 0, 0}, dim{dimRef, e.Referrer, "", 0, 0}, dim{dimDevice, e.Device, "", 0, 0}, dim{dimBrowser, e.Browser, "", 0, 0})
			if e.Country != "" {
				dims = append(dims, dim{dimCountry, e.Country, "", 0, 0})
			}
		}
		if e.Geo && (e.API || e.Pageview) {
			dims = append(dims, dim{dimPlace, e.City, e.Country, e.Lat, e.Lon})
		}
		ids := make([]int64, len(dims))
		var clientID, pathID int64
		for i, d := range dims {
			ids[i], err = s.dimension(tx, d.k, d.label, d.extra, d.lat, d.lon)
			if err != nil {
				return err
			}
			if at > usedDimensions[ids[i]] {
				usedDimensions[ids[i]] = at
			}
			if d.k == dimClient {
				clientID = ids[i]
			}
			if d.k == dimPath {
				pathID = ids[i]
			}
		}
		if e.API {
			pid, er := s.dimension(tx, dimPath, e.Path, "", 0, 0)
			if er != nil {
				return er
			}
			aid, er := s.dimension(tx, dimAgent, e.Agent, "", 0, 0)
			if er != nil {
				return er
			}
			if at > usedDimensions[pid] {
				usedDimensions[pid] = at
			}
			if at > usedDimensions[aid] {
				usedDimensions[aid] = at
			}
			method := 1
			switch e.Method {
			case "POST":
				method = 2
			case "HEAD":
				method = 3
			case "PUT":
				method = 4
			case "DELETE":
				method = 5
			case "OPTIONS":
				method = 6
			}
			if _, err = raw.Exec(e.At.UnixMilli(), e.Status, method, pid, e.Origin, aid, e.MS); err != nil {
				return err
			}
		}
		for _, g := range granules {
			t := at / g * g
			if clientID > 0 && pathID > 0 {
				paths[pathKey{g, t, clientID, pathID, e.Origin}]++
			}
			v := int64(0)
			if len(e.ID) > 0 && (e.Pageview || e.Origin == 0 && e.API) {
				r, er := seen.Exec(g, t, e.ID)
				if er != nil {
					return er
				}
				v, _ = r.RowsAffected()
			}
			if g == 86400 {
				total.v += v
			}
			key := bucketKey{g, t}
			b := buckets[key]
			if b == nil {
				b = &bucket{}
				buckets[key] = b
			}
			b.v += v
			b.p += pv
			b.a[e.Origin] += api
			b.err += errorsN
			b.down += e.Down
			b.up += e.Up
			b.adown += e.Down * apiBytes
			b.aup += e.Up * apiBytes
			for i, d := range dims {
				origin := e.Origin
				if e.Pageview {
					origin = 3
				}
				n := int64(1)
				if d.k == dimPlace && e.Pageview {
					if len(e.ID) == 0 {
						continue
					}
					r, er := placeSeen.Exec(g, t, ids[i], e.ID)
					if er != nil {
						return er
					}
					n, _ = r.RowsAffected()
					if n == 0 {
						continue
					}
				}
				key := factKey{g, t, ids[i], origin}
				f := facts[key]
				if f == nil {
					f = &aggregate{h: []byte{}}
					facts[key] = f
				}
				f.n += n
				f.e += errorsN
				if e.At.UnixMilli() > f.last {
					f.last = e.At.UnixMilli()
				}
				if d.k == dimPath || d.k == dimClient {
					f.h = mergeHist(f.h, hist(e.MS))
				}
			}
		}
	}
	if _, err = tx.Exec("UPDATE totals SET v=v+?,p=p+?,a0=a0+?,a1=a1+?,a2=a2+?,down=down+?,up=up+?,adown=adown+?,aup=aup+?,c=c+? WHERE id=1", total.v, total.p, total.a[0], total.a[1], total.a[2], total.down, total.up, total.adown, total.aup, newClients); err != nil {
		return err
	}
	bucketStmt, err := tx.Prepare(`INSERT INTO buckets(g,t,v,p,a0,a1,a2,err,down,up,adown,aup) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(g,t) DO UPDATE SET v=v+excluded.v,p=p+excluded.p,a0=a0+excluded.a0,a1=a1+excluded.a1,a2=a2+excluded.a2,err=err+excluded.err,down=down+excluded.down,up=up+excluded.up,adown=adown+excluded.adown,aup=aup+excluded.aup`)
	if err != nil {
		return err
	}
	defer bucketStmt.Close()
	for k, b := range buckets {
		if _, err = bucketStmt.Exec(k.g, k.t, b.v, b.p, b.a[0], b.a[1], b.a[2], b.err, b.down, b.up, b.adown, b.aup); err != nil {
			return err
		}
	}
	prior, err := tx.Prepare("SELECT h FROM facts WHERE g=? AND t=? AND d=? AND o=?")
	if err != nil {
		return err
	}
	defer prior.Close()
	factStmt, err := tx.Prepare(`INSERT INTO facts(g,t,d,o,n,e,last,h) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(g,t,d,o) DO UPDATE SET n=n+excluded.n,e=e+excluded.e,last=MAX(last,excluded.last),h=excluded.h`)
	if err != nil {
		return err
	}
	defer factStmt.Close()
	for k, f := range facts {
		var old []byte
		err = prior.QueryRow(k.g, k.t, k.d, k.o).Scan(&old)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		f.h = mergeHist(old, f.h)
		if _, err = factStmt.Exec(k.g, k.t, k.d, k.o, f.n, f.e, f.last, f.h); err != nil {
			return err
		}
	}
	pathStmt, err := tx.Prepare(`INSERT INTO client_paths VALUES(?,?,?,?,?,?) ON CONFLICT(g,t,c,p,o) DO UPDATE SET n=n+excluded.n`)
	if err != nil {
		return err
	}
	defer pathStmt.Close()
	for k, n := range paths {
		if _, err = pathStmt.Exec(k.g, k.t, k.c, k.p, k.o, n); err != nil {
			return err
		}
	}
	touch, err := tx.Prepare("UPDATE dimensions SET last=MAX(last,?) WHERE id=?")
	if err != nil {
		return err
	}
	defer touch.Close()
	for id, at := range usedDimensions {
		if _, err = touch.Exec(at, id); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	failed = false
	return nil
}
func (s *Store) Prune(ctx context.Context, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"buckets", "facts", "seen", "place_seen", "client_paths"} {
		for _, g := range granules {
			cutoff := now.Add(-30 * 24 * time.Hour).Unix()
			if g == 60 {
				cutoff = now.Add(-48 * time.Hour).Unix()
			}
			if _, err = tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE g=? AND t<?", g, cutoff); err != nil {
				return err
			}
		}
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM events WHERE at<?", now.Add(-48*time.Hour).UnixMilli()); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM auth_revoked WHERE expires<?", now.Unix()); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM dimensions WHERE last<?", now.Add(-30*24*time.Hour).Unix()); err != nil {
		return err
	}
	clear(s.dims)
	return tx.Commit()
}

// Numeric pins are independent of visitor records and survive retention forever.
func (s *Store) Allow(ctx context.Context, aliases []string, login string, id int64) (bool, error) {
	if id <= 0 {
		return false, nil
	}
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return false, e
	}
	defer tx.Rollback()
	for _, alias := range aliases {
		var pinned int64
		err := tx.QueryRowContext(ctx, "SELECT github_id FROM auth_pins WHERE alias=?", alias).Scan(&pinned)
		if err == nil && pinned == id {
			return true, nil
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return false, err
		}
		if errors.Is(err, sql.ErrNoRows) && strings.EqualFold(alias, login) {
			if _, err = tx.ExecContext(ctx, "INSERT INTO auth_pins(alias,github_id)VALUES(?,?)", alias, id); err != nil {
				return false, err
			}
			return true, tx.Commit()
		}
	}
	return false, nil
}
func (s *Store) Pinned(ctx context.Context, aliases []string, id int64) bool {
	for _, alias := range aliases {
		var found int64
		if s.read.QueryRowContext(ctx, "SELECT github_id FROM auth_pins WHERE alias=?", alias).Scan(&found) == nil && found == id {
			return true
		}
	}
	return false
}
func (s *Store) Revoke(ctx context.Context, nonce string, expires int64) error {
	_, e := s.db.ExecContext(ctx, "INSERT OR IGNORE INTO auth_revoked VALUES(?,?)", nonce, expires)
	return e
}
func (s *Store) Revoked(ctx context.Context, nonce string) bool {
	var n int
	err := s.read.QueryRowContext(ctx, "SELECT 1 FROM auth_revoked WHERE nonce=?", nonce).Scan(&n)
	return err == nil || err != sql.ErrNoRows
}

func dimensionText(v string) string {
	v = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, v)
	if len(v) > 120 {
		v = v[:120]
	}
	return v
}

func clientNetwork(network string, origin int) string {
	parts := strings.Fields(network)
	key := "Unknown network"
	if len(parts) > 0 && strings.HasPrefix(parts[0], "AS") {
		key = parts[0]
	}
	if origin == 2 && strings.HasSuffix(network, " (verified)") {
		key += " (verified)"
	}
	return key
}

// Configure before serving requests; the validation cache belongs to the sole writer.
func (s *Store) SetSelectionLookup(lookup func(context.Context, string, string) (bool, error)) {
	s.selectionKnown = lookup
}
func (s *Store) knownSelection(kind, value string) string {
	if value == "" || s.selectionKnown == nil {
		return ""
	}
	key := kind + "\x00" + value
	if entry, ok := s.selections[key]; ok && time.Now().Before(entry.until) {
		if entry.known {
			return value
		}
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	known, err := s.selectionKnown(ctx, kind, value)
	cancel()
	ttl := time.Hour
	if !known {
		ttl = time.Minute
	}
	if err != nil {
		known = false
		ttl = 5 * time.Second
	}
	if s.selections == nil {
		s.selections = map[string]selectionEntry{}
	}
	if len(s.selections) >= 2048 {
		clear(s.selections)
	}
	s.selections[key] = selectionEntry{known: known, until: time.Now().Add(ttl)}
	if known {
		return value
	}
	return ""
}
