package store

import (
	"context"
	"crypto/sha256"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const nativeProofLimit = 256

// Fixed-size receipts only: no function lists, text, or decoded evidence is
// retained. A pass never survives its publication/reachability operation.
type nativeProof struct {
	Module [32]byte
	Bound  bool
}
type nativeValidationPass struct{ receipts map[[32]byte]nativeProof }

func (p *nativeValidationPass) validate(ctx context.Context, s *Store, artifact wire.Artifact, module string, fetch func(string) ([]byte, error)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if artifact.Inspection.Metadata == "" {
		return s.validateNativeInspection(artifact, module, fetch)
	}
	encoded, err := wire.Encode(artifact)
	if err != nil {
		return err
	}
	key := sha256.Sum256(encoded)
	expected := sha256.Sum256([]byte(module))
	if receipt, ok := p.receipts[key]; ok {
		if module == "" || receipt.Bound && receipt.Module == expected {
			return nil
		}
		// A differing module must still reach the original native identity check.
		// Unbound proofs cannot establish a later result's module contract.
	}
	if err = s.validateNativeInspection(artifact, module, func(id string) ([]byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return fetch(id)
	}); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if p.receipts == nil {
		p.receipts = make(map[[32]byte]nativeProof)
	}
	if _, exists := p.receipts[key]; exists || len(p.receipts) < nativeProofLimit {
		p.receipts[key] = nativeProof{Module: expected, Bound: module != ""}
	}
	return nil
}
