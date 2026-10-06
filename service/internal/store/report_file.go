package store

import (
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"io"
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
	if set.Count > 9 {
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

// Preflight verifies the whole original before HTTP success headers. Streaming
// rechecks each immutable chunk to catch corruption occurring after preflight.
func (s *Store) OpenReportFile(ctx context.Context, revision, id string) (wire.ReportFile, io.Reader, error) {
	record, err := s.Record(revision, "report-file", id)
	if err != nil {
		return wire.ReportFile{}, nil, err
	}
	file, err := wire.ReportFileData(record.Data)
	if err != nil {
		return file, nil, err
	}
	fetch := func(chunk wire.FileChunk) ([]byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		b, err := s.objectRepresentation(wire.Object{SHA256: chunk.SHA256, Bytes: chunk.Bytes, Kind: "binary"})
		if err == nil {
			err = ctx.Err()
		}
		return b, err
	}
	if err = wire.VerifyReportFile(file, fetch); err != nil {
		return file, nil, err
	}
	return file, &reportFileReader{ctx: ctx, chunks: append([]wire.FileChunk{}, file.Chunks...), fetch: fetch}, nil
}

type reportFileReader struct {
	ctx     context.Context
	chunks  []wire.FileChunk
	fetch   func(wire.FileChunk) ([]byte, error)
	next    int
	current []byte
	offset  int
}

func (r *reportFileReader) Read(dst []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if len(dst) == 0 {
		return 0, nil
	}
	if r.offset == len(r.current) {
		r.current = nil
		r.offset = 0
		if r.next == len(r.chunks) {
			return 0, io.EOF
		}
		chunk := r.chunks[r.next]
		b, err := r.fetch(chunk)
		if err != nil {
			return 0, err
		}
		if len(b) != chunk.Bytes || wire.Hash(b) != chunk.SHA256 {
			return 0, wire.Invalid("report file chunk differs during streaming")
		}
		r.current = b
		r.next++
	}
	n := copy(dst, r.current[r.offset:])
	r.offset += n
	return n, nil
}
