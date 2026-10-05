package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type GCOptions struct {
	Apply           bool
	Grace           time.Duration
	QuarantineGrace time.Duration
	Now             time.Time
}
type GCReport struct {
	Candidates  int   `json:"candidates"`
	Quarantined int   `json:"quarantined"`
	Deleted     int   `json:"deleted"`
	Unknown     int   `json:"unknownFiles"`
	BytesFreed  int64 `json:"bytesFreed"`
}
type quarantineReceipt struct {
	Schema      int       `json:"schema"`
	Digest      string    `json:"digest"`
	Bytes       int64     `json:"bytes"`
	Quarantined time.Time `json:"quarantinedAt"`
}

// GC retains every published revision and active import. It rechecks marks on
// every pass, quarantines unreachable content, and deletes only receipted bytes
// after a second grace interval. Unknown files are reported and left alone.
func (s *Store) GC(ctx context.Context, options GCOptions) (GCReport, error) {
	report := GCReport{}
	if options.Grace < time.Hour || options.QuarantineGrace < time.Hour {
		return report, wire.Invalid("cleanup grace periods must be at least one hour")
	}
	if options.Now.IsZero() {
		options.Now = time.Now().UTC()
	}
	s.publish.Lock()
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return report, ErrNeedsRestart
	}
	s.contentMu.Lock()
	defer s.contentMu.Unlock()
	marked, e := s.reachable(true)
	if e != nil {
		return report, e
	}
	directory := filepath.Join(s.root, "quarantine")
	if options.Apply {
		if e = os.MkdirAll(directory, 0700); e != nil {
			return report, e
		}
		info, e := os.Lstat(directory)
		if e != nil {
			return report, e
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return report, fmt.Errorf("invalid quarantine directory")
		}
		if e = syncDir(s.root); e != nil {
			return report, e
		}
	}
	entries, e := os.ReadDir(filepath.Join(s.root, "objects"))
	if e != nil {
		return report, e
	}
	for _, entry := range entries {
		if e = ctx.Err(); e != nil {
			return report, e
		}
		id := entry.Name()
		if !wire.IsHash(id) {
			report.Unknown++
			continue
		}
		if marked[id] {
			continue
		}
		info, e := entry.Info()
		if e != nil {
			return report, e
		}
		if !info.Mode().IsRegular() {
			return report, fmt.Errorf("non-regular orphan content")
		}
		if options.Now.Sub(info.ModTime()) < options.Grace {
			continue
		}
		data, e := s.content(id)
		if e != nil {
			return report, e
		}
		report.Candidates++
		if !options.Apply {
			continue
		}
		receipt := quarantineReceipt{1, id, int64(len(data)), options.Now}
		path := filepath.Join(directory, id)
		existing := false
		if _, e = os.Lstat(path); e == nil {
			fs, e := os.OpenRoot(directory)
			if e != nil {
				return report, e
			}
			old, e := readRegular(fs, id, wire.ChunkBytes)
			if e != nil {
				fs.Close()
				return report, e
			}
			if wire.Hash(old) != id {
				fs.Close()
				return report, fmt.Errorf("quarantine collision")
			}
			metadata, e := readRegular(fs, id+".json", 4096)
			fs.Close()
			if e != nil {
				return report, e
			}
			var recorded quarantineReceipt
			if e = wire.Decode(metadata, &recorded); e != nil {
				return report, e
			}
			if recorded.Schema != 1 || recorded.Digest != id || recorded.Bytes != int64(len(data)) {
				return report, fmt.Errorf("quarantine receipt differs")
			}
			existing = true
		} else if !os.IsNotExist(e) {
			return report, e
		}
		if !existing {
			encoded, _ := wire.Encode(receipt)
			if e = atomicFile(path+".json", encoded, 0600); e != nil {
				return report, e
			}
			if e = os.Link(filepath.Join(s.root, "objects", id), path); e != nil {
				return report, e
			}
			if e = syncDir(directory); e != nil {
				return report, e
			}
		}
		if e = s.objects.Remove(id); e != nil {
			return report, e
		}
		if existing {
			s.contentBytes -= int64(len(data))
		}
		if e = syncDir(filepath.Join(s.root, "objects")); e != nil {
			return report, e
		}
		report.Quarantined++
	}
	receipts, e := os.ReadDir(directory)
	if os.IsNotExist(e) {
		return report, nil
	}
	if e != nil {
		return report, e
	}
	quarantine, e := os.OpenRoot(directory)
	if e != nil {
		return report, e
	}
	defer quarantine.Close()
	for _, entry := range receipts {
		if e = ctx.Err(); e != nil {
			return report, e
		}
		name := entry.Name()
		if len(name) != 69 || name[64:] != ".json" || !wire.IsHash(name[:64]) {
			continue
		}
		id := name[:64]
		b, e := readRegular(quarantine, name, 4096)
		if e != nil {
			return report, e
		}
		var receipt quarantineReceipt
		if e = wire.Decode(b, &receipt); e != nil {
			return report, e
		}
		if receipt.Schema != 1 || receipt.Digest != id || receipt.Bytes < 0 || receipt.Bytes > wire.ChunkBytes {
			return report, fmt.Errorf("invalid quarantine receipt")
		}
		// Missing files can result from a crash after unlink; retain the receipt
		// until cleanup runs in apply mode, then finish the idempotent removal.
		b, e = readRegular(quarantine, id, wire.ChunkBytes)
		if os.IsNotExist(e) {
			if options.Apply {
				if e = quarantine.Remove(name); e != nil {
					return report, e
				}
			}
			continue
		}
		if e != nil {
			return report, e
		}
		if int64(len(b)) != receipt.Bytes || wire.Hash(b) != id {
			return report, fmt.Errorf("quarantined content differs")
		}
		if marked[id] {
			if options.Apply {
				if _, e = s.content(id); os.IsNotExist(e) {
					if e = os.Link(filepath.Join(directory, id), filepath.Join(s.root, "objects", id)); e != nil {
						return report, e
					}
					s.contentBytes += receipt.Bytes
					if e = syncDir(filepath.Join(s.root, "objects")); e != nil {
						return report, e
					}
				} else if e != nil {
					return report, e
				}
				if e = quarantine.Remove(id); e != nil {
					return report, e
				}
				s.contentBytes -= receipt.Bytes
				if e = syncDir(directory); e != nil {
					return report, e
				}
				if e = quarantine.Remove(name); e != nil {
					return report, e
				}
			}
			continue
		}
		if options.Now.Sub(receipt.Quarantined) < options.QuarantineGrace {
			continue
		}
		if !options.Apply {
			continue
		}
		if e = quarantine.Remove(id); e != nil {
			return report, e
		}
		if e = syncDir(directory); e != nil {
			return report, e
		}
		if e = quarantine.Remove(name); e != nil {
			return report, e
		}
		report.Deleted++
		report.BytesFreed += receipt.Bytes
		s.contentBytes -= receipt.Bytes
	}
	if options.Apply {
		if e = syncDir(directory); e != nil {
			return report, e
		}
	}
	return report, nil
}
