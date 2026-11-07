// Package artifactdb indexes public corpus binaries independently of measurements.
// Binaries are content-addressed files; compressed contracts live in SQLite.
package artifactdb

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const Retention = 90 * 24 * time.Hour
const MaxBytes int64 = 256 << 20

var ErrInvalid = errors.New("invalid artifact")
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func ValidHash(s string) bool { return hashPattern.MatchString(s) }

type Store struct {
	db   *sql.DB
	root *os.Root
	mu   sync.RWMutex
	now  func() time.Time
}
type Entry struct {
	SHA256         string          `json:"sha256"`
	Bytes          int64           `json:"bytes"`
	PublishedAt    string          `json:"publishedAt"`
	ExpiresAt      string          `json:"expiresAt"`
	Workload       json.RawMessage `json:"workload"`
	ContractSHA256 string          `json:"contractSha256"`
}
type Query struct {
	Workload, Prefix, SHA256, After string
	Limit                           int
}
type Page struct {
	Artifacts []Entry `json:"artifacts"`
	Next      string  `json:"next,omitempty"`
}

func Open(directory string) (*Store, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite3", filepath.Join(directory, "index.sqlite")+"?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		root.Close()
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS blobs(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,published INTEGER NOT NULL,expires INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS blobs_expiry ON blobs(expires);CREATE TABLE IF NOT EXISTS contracts(id TEXT NOT NULL,contract TEXT NOT NULL,hash TEXT NOT NULL REFERENCES blobs(hash) ON DELETE CASCADE,body BLOB NOT NULL,PRIMARY KEY(id,contract));CREATE INDEX IF NOT EXISTS contracts_hash ON contracts(hash);`)
	if err != nil {
		db.Close()
		root.Close()
		return nil, err
	}
	return &Store{db: db, root: root, now: time.Now}, nil
}
func (s *Store) Close() error { return errors.Join(s.db.Close(), s.root.Close()) }
func (s *Store) Put(ctx context.Context, hash string, r io.Reader) (int64, error) {
	if !ValidHash(hash) {
		return 0, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// A random exclusive temporary file prevents partial downloads and concurrent replacement.
	f, err := os.CreateTemp(s.root.Name(), ".upload-*")
	if err != nil {
		return 0, err
	}
	name := filepath.Base(f.Name())
	defer s.root.Remove(name)
	h := sha256.New()
	var header bytes.Buffer
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(r, MaxBytes+1))
	if err == nil {
		_, err = f.Seek(0, 0)
	}
	if err == nil {
		_, err = io.CopyN(&header, f, 8)
	}
	closeErr := f.Close()
	if err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return 0, ErrInvalid
		}
		return 0, err
	}
	if closeErr != nil {
		return 0, closeErr
	}
	// Core (v1) and component (v0x1000d) encodings are both valid Wasm artifacts.
	b := header.Bytes()
	if n > MaxBytes || !bytes.Equal(b[:4], []byte{0, 97, 115, 109}) || !(bytes.Equal(b[4:], []byte{1, 0, 0, 0}) || bytes.Equal(b[4:], []byte{13, 0, 1, 0})) || hex.EncodeToString(h.Sum(nil)) != hash {
		return 0, ErrInvalid
	}
	if err = s.root.Rename(name, hash+".wasm"); err != nil {
		return 0, err
	}
	now := s.now()
	_, err = s.db.ExecContext(ctx, `INSERT INTO blobs VALUES(?,?,?,?) ON CONFLICT(hash) DO UPDATE SET published=excluded.published,expires=excluded.expires`, hash, n, now.Unix(), now.Add(Retention).Unix())
	return n, err
}
func (s *Store) Register(ctx context.Context, contract string, body json.RawMessage) error {
	var w struct {
		ID  string `json:"id"`
		SHA string `json:"sha256"`
	}
	if len(body) > 768<<10 || json.Unmarshal(body, &w) != nil || w.ID == "" || strings.ContainsRune(w.ID, 0) || len(w.ID) > 512 || !ValidHash(w.SHA) || !ValidHash(contract) {
		return ErrInvalid
	}
	canonical, err := json.Marshal(body)
	if err != nil || len(canonical) > 768<<10 {
		return ErrInvalid
	}
	body = canonical
	var compressed bytes.Buffer
	z := gzip.NewWriter(&compressed)
	if _, err := z.Write(body); err != nil {
		return err
	}
	if err := z.Close(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE blobs SET published=?,expires=? WHERE hash=? AND expires>?`, now.Unix(), now.Add(Retention).Unix(), w.SHA, now.Unix())
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return os.ErrNotExist
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO contracts VALUES(?,?,?,?) ON CONFLICT(id,contract) DO UPDATE SET hash=excluded.hash,body=excluded.body`, w.ID, contract, w.SHA, compressed.Bytes())
	if err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) List(ctx context.Context, q Query) (Page, error) {
	out := Page{Artifacts: []Entry{}}
	if q.Limit == 0 {
		q.Limit = 100
	}
	if q.Limit < 1 || q.Limit > 500 || len(q.Prefix) > 512 || len(q.Workload) > 512 || q.SHA256 != "" && !ValidHash(q.SHA256) {
		return out, ErrInvalid
	}
	// Cursor is the unique (id, contract) pair; both parts are bound parameters.
	afterID, afterContract := "", ""
	if q.After != "" {
		raw, err := hex.DecodeString(q.After)
		if err != nil || len(raw) > 1024 {
			return out, ErrInvalid
		}
		parts := bytes.SplitN(raw, []byte{0}, 2)
		if len(parts) != 2 {
			return out, ErrInvalid
		}
		afterID, afterContract = string(parts[0]), string(parts[1])
	}
	rows, err := s.db.QueryContext(ctx, `SELECT c.id,c.contract,b.hash,b.size,b.published,b.expires,c.body FROM contracts c JOIN blobs b ON b.hash=c.hash WHERE b.expires>? AND (?='' OR c.id=?) AND (?='' OR substr(c.id,1,length(?))=?) AND (?='' OR b.hash=?) AND (c.id>? OR (c.id=? AND c.contract>?)) ORDER BY c.id,c.contract LIMIT ?`, s.now().Unix(), q.Workload, q.Workload, q.Prefix, q.Prefix, q.Prefix, q.SHA256, q.SHA256, afterID, afterID, afterContract, q.Limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	last := ""
	pageBytes := 0
	for rows.Next() {
		var e Entry
		var id string
		var published, expires int64
		var body []byte
		if err = rows.Scan(&id, &e.ContractSHA256, &e.SHA256, &e.Bytes, &published, &expires, &body); err != nil {
			return out, err
		}
		if len(out.Artifacts) == q.Limit {
			out.Next = last
			break
		}
		z, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			return out, err
		}
		e.Workload, err = io.ReadAll(io.LimitReader(z, 1<<20+1))
		z.Close()
		if err != nil || len(e.Workload) > 1<<20 {
			return out, fmt.Errorf("invalid stored contract")
		}
		e.PublishedAt = time.Unix(published, 0).UTC().Format(time.RFC3339)
		e.ExpiresAt = time.Unix(expires, 0).UTC().Format(time.RFC3339)
		encoded, err := json.Marshal(e)
		if err != nil {
			return out, err
		}
		if pageBytes+len(encoded) > 900<<10 {
			out.Next = last
			break
		}
		pageBytes += len(encoded) + 1
		out.Artifacts = append(out.Artifacts, e)
		last = hex.EncodeToString([]byte(id + "\x00" + e.ContractSHA256))
	}
	return out, rows.Err()
}
func (s *Store) Download(ctx context.Context, hash string) (*os.File, time.Time, time.Time, error) {
	if !ValidHash(hash) {
		return nil, time.Time{}, time.Time{}, os.ErrNotExist
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var published, expires int64
	err := s.db.QueryRowContext(ctx, `SELECT published,expires FROM blobs WHERE hash=? AND expires>?`, hash, s.now().Unix()).Scan(&published, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		err = os.ErrNotExist
	}
	if err != nil {
		return nil, time.Time{}, time.Time{}, err
	}
	f, err := s.root.Open(hash + ".wasm")
	return f, time.Unix(published, 0), time.Unix(expires, 0), err
}
func (s *Store) Prune(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.QueryContext(ctx, `SELECT hash FROM blobs WHERE expires<=?`, s.now().Unix())
	if err != nil {
		return err
	}
	var hashes []string
	for rows.Next() {
		var h string
		if err = rows.Scan(&h); err != nil {
			break
		}
		hashes = append(hashes, h)
	}
	readErr := rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if readErr != nil {
		return readErr
	}
	for _, h := range hashes {
		if err = s.root.Remove(h + ".wasm"); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if _, err = s.db.ExecContext(ctx, `DELETE FROM blobs WHERE hash=?`, h); err != nil {
			return err
		}
	}
	// Also collect completed files left behind if a database write/process failed.
	files, err := os.ReadDir(s.root.Name())
	if err != nil {
		return err
	}
	for _, f := range files {
		n := f.Name()
		info, err := f.Info()
		if err != nil {
			return err
		}
		if time.Since(info.ModTime()) < time.Hour {
			continue
		}
		if strings.HasPrefix(n, ".upload-") {
			if err = s.root.Remove(n); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			continue
		}
		if len(n) != 69 || n[64:] != ".wasm" || !ValidHash(n[:64]) {
			continue
		}
		var exists int
		if err = s.db.QueryRowContext(ctx, `SELECT count(*) FROM blobs WHERE hash=?`, n[:64]).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			if err = s.root.Remove(n); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}
