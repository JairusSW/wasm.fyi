package store

import (
	"bytes"
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNativeProofReuseBoundsModuleBindingAndFreshCorruption(t *testing.T) {
	_, objects, artifactID, err := testutil.DisassemblyFixture("native-proof", time.Now().UTC(), "header\n0: nop\n1: ret\n")
	if err != nil {
		t.Fatal(err)
	}
	s := openTest(t, t.TempDir())
	defer s.Close()
	for id, b := range objects {
		if err = s.Install(id, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	var artifact wire.Artifact
	for _, b := range objects {
		var r wire.Record
		if wire.Decode(b, &r) == nil && r.Kind == "artifact" && r.ID == artifactID {
			artifact, err = wire.ArtifactData(r.Data)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	var metadata wire.NativeMetadata
	if err = wire.Decode(objects[artifact.Inspection.Metadata], &metadata); err != nil {
		t.Fatal(err)
	}
	reads := 0
	fetch := func(id string) ([]byte, error) { reads++; return s.content(id) }
	var pass nativeValidationPass
	ctx := context.Background()
	module := metadata.Image.ModuleSHA256
	if err = pass.validate(ctx, s, artifact, module, fetch); err != nil {
		t.Fatal(err)
	}
	cold := reads
	if cold < 3 {
		t.Fatal("proof did not verify diagnostic bodies", cold)
	}
	if err = pass.validate(ctx, s, artifact, "", fetch); err != nil || reads != cold {
		t.Fatal("same-pass artifact proof repeated", reads, err)
	}
	if err = pass.validate(ctx, s, artifact, module, fetch); err != nil || reads != cold {
		t.Fatal("same result module proof repeated", reads, err)
	}
	if err = pass.validate(ctx, s, artifact, wire.Hash([]byte("foreign-module")), fetch); err == nil || reads == cold {
		t.Fatal("cached proof authorized another module")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err = pass.validate(canceled, s, artifact, module, fetch); err == nil {
		t.Fatal("cached proof bypassed cancellation")
	}
	var unbound nativeValidationPass
	if err = unbound.validate(ctx, s, artifact, "", fetch); err != nil {
		t.Fatal(err)
	}
	before := reads
	if err = unbound.validate(ctx, s, artifact, module, fetch); err != nil || reads == before {
		t.Fatal("unbound proof skipped module identity", err)
	}
	// Filling the receipt budget cannot retain more data or suppress new proofs.
	pass.receipts = map[[32]byte]nativeProof{}
	for i := 0; i < nativeProofLimit; i++ {
		var key [32]byte
		key[0] = byte(i)
		pass.receipts[key] = nativeProof{}
	}
	before = reads
	if err = pass.validate(ctx, s, artifact, module, fetch); err != nil || reads == before || len(pass.receipts) != nativeProofLimit {
		t.Fatal("receipt budget", err, len(pass.receipts))
	}
	// Later operations never reuse earlier receipts. Fresh missing/corrupt content
	// is detected even though this descriptor was successfully validated before.
	chunk := ""
	for id, b := range objects {
		var lines wire.DisassemblyLines
		if wire.Decode(b, &lines) == nil && lines.Kind == "native-disassembly-lines" {
			chunk = id
			break
		}
	}
	if chunk == "" {
		t.Fatal("missing fixture")
	}
	if err = os.Remove(filepath.Join(s.root, "objects", chunk)); err != nil {
		t.Fatal(err)
	}
	var next nativeValidationPass
	if err = next.validate(ctx, s, artifact, module, fetch); err == nil || len(next.receipts) != 0 {
		t.Fatal("fresh missing diagnostic reused prior proof")
	}
	if err = os.WriteFile(filepath.Join(s.root, "objects", chunk), []byte("corrupt diagnostic"), 0600); err != nil {
		t.Fatal(err)
	}
	var corrupt nativeValidationPass
	if err = corrupt.validate(ctx, s, artifact, module, fetch); err == nil || len(corrupt.receipts) != 0 {
		t.Fatal("fresh corruption reused prior proof")
	}
}
