`site-v2` is a small **synthetic** producer-export golden fixture. It contains
one launch with three inner samples, zero timing/RSS values and absent intervals,
timing-pass RSS, and engine-reported code size with no native bytes. It is not
scientific evidence and must never be imported into a production dataset.

Regenerate from the producer branch's `publish/site_export_test.go`:

```sh
WASMFYI_FIXTURE_OUT=/absolute/new/fixture-directory go test ./publish -run TestSiteExportParityAndBounds -count=1
```

The destination must not already exist. Replace this fixture only after reviewing
changes to both hashes and decoded semantics. Service tests derive additional
synthetic deliveries from it; exporter tests exercise actual sealed-report
verification separately.
