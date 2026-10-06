package store

import (
	"context"
	"errors"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"io"
	"testing"
)

func TestReportFileReaderBoundsAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	chunks := []wire.FileChunk{{SHA256: wire.Hash([]byte("first")), Bytes: 5}, {SHA256: wire.Hash([]byte("second")), Bytes: 6}}
	calls := 0
	reader := &reportFileReader{ctx: ctx, chunks: chunks, fetch: func(chunk wire.FileChunk) ([]byte, error) {
		calls++
		if chunk.Bytes == 5 {
			return []byte("first"), nil
		}
		return []byte("second"), nil
	}}
	buf := make([]byte, 2)
	n, err := reader.Read(buf)
	if err != nil || n != 2 || calls != 1 || string(buf) != "fi" {
		t.Fatal(n, err, calls)
	}
	if _, err = reader.Read(nil); err != nil || calls != 1 {
		t.Fatal("zero read fetched content")
	}
	cancel()
	if _, err = reader.Read(buf); !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatal("cancellation fetched another chunk", err, calls)
	}
	bad := &reportFileReader{ctx: context.Background(), chunks: chunks, fetch: func(wire.FileChunk) ([]byte, error) { return []byte("wrong"), nil }}
	if n, err := bad.Read(buf); n != 0 || err == nil {
		t.Fatal("corrupt chunk emitted bytes")
	}
	empty := &reportFileReader{ctx: context.Background()}
	if n, err := empty.Read(buf); n != 0 || err != io.EOF {
		t.Fatal("empty file not EOF")
	}
}
