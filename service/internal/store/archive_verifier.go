package store

import "github.com/JairusSW/wasm.fyi/service/internal/wire"

const archiveVerificationCacheEntries = 128
const archiveVerificationCacheBytes = 32 << 10
const archiveVerificationEntryCost = 256

// Receipts are local to one typed-closure pass. They retain only fixed-size
// identity keys, never archive bytes or descriptor arrays.
type archiveVerifier struct {
	fetch       func(wire.Object) ([]byte, error)
	order       [archiveVerificationCacheEntries]string
	next, count int
	bytes       int
}

func (v *archiveVerifier) verify(job wire.Job) error {
	if job.ParentArchive == nil {
		return wire.Invalid("missing parent archive")
	}
	if e := job.ParentArchive.Validate(job); e != nil {
		return e
	}
	descriptor, e := wire.Encode(job.ParentArchive)
	if e != nil {
		return e
	}
	identity, e := wire.Encode([]string{job.Session, job.Machine, job.Plan, job.ConfiguredHarnessPin, job.ParentBundleSHA256, wire.Hash(descriptor)})
	if e != nil {
		return e
	}
	key := wire.Hash(identity)
	for _, receipt := range v.order {
		if receipt == key {
			return nil
		}
	}
	if e := job.ParentArchive.Verify(job, v.fetch); e != nil {
		return e
	}
	for v.count >= archiveVerificationCacheEntries || v.bytes+archiveVerificationEntryCost > archiveVerificationCacheBytes {
		oldest := (v.next - v.count + archiveVerificationCacheEntries) % archiveVerificationCacheEntries
		v.order[oldest] = ""
		v.count--
		v.bytes -= archiveVerificationEntryCost
	}
	v.order[v.next] = key
	v.next = (v.next + 1) % archiveVerificationCacheEntries
	v.count++
	v.bytes += archiveVerificationEntryCost
	return nil
}
