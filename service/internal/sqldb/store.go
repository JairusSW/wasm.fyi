// Package sqldb owns the normalized embedded SQL benchmark database.
package sqldb

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed schema.sql
var schema string

//go:embed summary_migration.sql
var summaryMigration string

type Store struct {
	writer            *sql.DB
	reader            *sql.DB
	write             sync.Mutex
	cursorKey         []byte
	aggregateMu       sync.Mutex
	aggregateCache    map[string]aggregateCacheEntry
	aggregateBytes    int
	aggregateSequence uint64
}

func Open(directory string) (*Store, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	path, err := filepath.Abs(filepath.Join(directory, "benchmarks.sqlite"))
	if err != nil {
		return nil, err
	}
	uri := url.URL{Scheme: "file", Path: path}
	query := url.Values{"_journal_mode": {"WAL"}, "_synchronous": {"FULL"}, "_foreign_keys": {"on"}, "_busy_timeout": {"5000"}, "_cache_size": {"-8192"}}
	query.Set("_txlock", "immediate")
	uri.RawQuery = query.Encode()
	writer, err := sql.Open("sqlite3", uri.String())
	if err != nil {
		return nil, err
	}
	writer.SetMaxOpenConns(1)
	writer.SetMaxIdleConns(1)
	fail := func(err error) (*Store, error) { writer.Close(); return nil, err }
	if err = writer.Ping(); err != nil {
		return fail(err)
	}
	var version int
	if err = writer.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fail(err)
	}
	if version != 0 && version != 1 && version != 2 && version != 3 && version != 4 {
		return fail(fmt.Errorf("unsupported SQL schema %d", version))
	}
	if err = migrateSchema(context.Background(), writer); err != nil {
		return fail(err)
	}
	query.Set("_txlock", "deferred")
	query.Set("mode", "ro")
	uri.RawQuery = query.Encode()
	reader, err := sql.Open("sqlite3", uri.String())
	if err != nil {
		return fail(err)
	}
	reader.SetMaxOpenConns(4)
	reader.SetMaxIdleConns(4)
	if err = reader.Ping(); err != nil {
		reader.Close()
		return fail(err)
	}
	s := &Store{writer: writer, reader: reader}
	if err = s.initialize(context.Background()); err != nil {
		reader.Close()
		return fail(err)
	}
	if _, err = s.RepairUnknownMemoryPlatforms(context.Background()); err != nil {
		reader.Close()
		return fail(err)
	}
	return s, nil
}

func (s *Store) Close() error {
	s.invalidateAggregates()
	readErr := s.reader.Close()
	_, checkpointErr := s.writer.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	writeErr := s.writer.Close()
	if readErr != nil {
		return readErr
	}
	if checkpointErr != nil {
		return checkpointErr
	}
	return writeErr
}

func (s *Store) Integrity(ctx context.Context) error {
	var result string
	if err := s.reader.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return err
	}
	if result != "ok" {
		return fmt.Errorf("SQL integrity check: %s", result)
	}
	rows, err := s.reader.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return fmt.Errorf("SQL foreign-key violation")
	}
	return rows.Err()
}

func migrateSchema(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, schema); err != nil {
		return err
	}
	var complete string
	err = tx.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key='summary-schema-v2'").Scan(&complete)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err = tx.ExecContext(ctx, summaryMigration); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if complete != "complete" {
		return fmt.Errorf("invalid scalar-summary migration marker")
	}
	err = tx.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key='sample-statistics-v3'").Scan(&complete)
	if errors.Is(err, sql.ErrNoRows) {
		if err = backfillSampleStats(ctx, tx); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if complete != "complete" {
		return fmt.Errorf("invalid sample-statistics migration marker")
	}
	err = tx.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key='scope-revisions-v4'").Scan(&complete)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO metadata(key,value) SELECT 'latest-revision/'||id,lower(hex(randomblob(32))) FROM platforms;INSERT OR IGNORE INTO metadata(key,value) SELECT 'history-revision/'||id,lower(hex(randomblob(32))) FROM platforms;INSERT INTO metadata(key,value) VALUES('scope-revisions-v4','complete')")
		if err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if complete != "complete" {
		return fmt.Errorf("invalid scoped-revision migration marker")
	}
	return tx.Commit()
}
