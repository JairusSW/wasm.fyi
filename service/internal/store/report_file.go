package store

import (
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func (s *Store) ReportFileChunk(ctx context.Context, revision, id, digest string) (wire.ReportFile, []byte, error) {
	record, err := s.Record(revision, "report-file", id)
	if err != nil {
		return wire.ReportFile{}, nil, err
	}
	file, err := wire.ReportFileData(record.Data)
	if err != nil {
		return file, nil, err
	}
	for _, chunk := range file.Chunks {
		if chunk.SHA256 == digest {
			if err := ctx.Err(); err != nil {
				return file, nil, err
			}
			b, err := s.objectRepresentation(wire.Object{SHA256: digest, Bytes: chunk.Bytes, Kind: "binary"})
			if err == nil {
				err = ctx.Err()
			}
			return file, b, err
		}
	}
	return file, nil, ErrNotFound
}

func (s *Store) ReportFiles(ctx context.Context, revision, report string) ([]wire.Record, error) {
	if _, err := s.Record(revision, "report", report); err != nil {
		return nil, err
	}
	rev, err := s.Revision(revision)
	if err != nil {
		return nil, err
	}
	set, err := s.indexGet(rev.Indexes, indexKey("report-files", report, ""))
	if err != nil {
		return nil, err
	}
	if set.Count > 8 {
		return nil, ErrLimit
	}
	rows := []wire.Record{}
	budget := 256
	err = s.walk(set.Root, &budget, func(name, digest string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		var record wire.Record
		if err := s.load(digest, &record); err != nil {
			return err
		}
		file, err := wire.ReportFileData(record.Data)
		if err != nil {
			return err
		}
		if record.Kind != "report-file" || file.ReportID != report || file.Name != name {
			return wire.Invalid("report file membership differs")
		}
		rows = append(rows, record)
		return nil
	})
	return rows, err
}
