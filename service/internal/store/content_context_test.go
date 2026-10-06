package store

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type cancelContentRead struct {
	cancel context.CancelFunc
	calls  int
	max    int
}

func (r *cancelContentRead) Read(p []byte) (int, error) {
	r.calls++
	r.max = max(r.max, len(p))
	for i := range p {
		p[i] = 42
	}
	r.cancel()
	return len(p), nil
}
func TestContentReadCancellationBoundsVerificationWork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	source := &cancelContentRead{cancel: cancel}
	data, e := io.ReadAll(contextContentReader{ctx, source})
	if !errors.Is(e, context.Canceled) || source.calls != 1 || source.max > 32*1024 || len(data) > 32*1024 {
		t.Fatal("continued reading canceled content", e, source.calls, source.max, len(data))
	}
	largeCtx, largeCancel := context.WithCancel(context.Background())
	defer largeCancel()
	largeSource := &cancelContentRead{cancel: largeCancel}
	reader := contextContentReader{largeCtx, largeSource}
	n, e := reader.Read(make([]byte, 128*1024))
	if e != nil || n != 32*1024 || largeSource.max != 32*1024 {
		t.Fatal("large caller buffer bypassed read bound", n, e, largeSource.max)
	}
	if n, e = reader.Read(make([]byte, 128*1024)); n != 0 || !errors.Is(e, context.Canceled) || largeSource.calls != 1 {
		t.Fatal("canceled reader issued another syscall", n, e)
	}
	s := openTest(t, t.TempDir())
	defer s.Close()
	// Cancellation is observed before any path lookup; even an absent valid
	// object must return the caller's cancellation rather than opening a file.
	if _, e = s.objectRepresentationContext(ctx, wire.Object{SHA256: wire.Hash([]byte("absent")), Kind: "binary"}); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	body := bytes.Repeat([]byte{42}, 256*1024)
	id := wire.Hash(body)
	if e = s.InstallBinary(id, bytes.NewReader(body)); e != nil {
		t.Fatal(e)
	}
	got, e := s.objectRepresentationContext(context.Background(), wire.Object{SHA256: id, Bytes: len(body), Kind: "binary"})
	if e != nil || !bytes.Equal(got, body) {
		t.Fatal("incremental verification changed original bytes", e)
	}
	if _, e = s.objectRepresentationContext(context.Background(), wire.Object{SHA256: id, Bytes: len(body) - 1, Kind: "binary"}); e == nil {
		t.Fatal("declared size mismatch accepted")
	}
}
