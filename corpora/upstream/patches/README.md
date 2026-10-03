# Editable upstream sources

The builder fetches complete source checkouts at pinned revisions into its staging
`tree/.tmp/` directory. To retain an upstream source edit, create a patch here:

```sh
git -C .wasmbench/source-builds/<build>/tree/.tmp/json2csv diff > corpora/upstream/patches/json2csv.patch
node scripts/corpus-rebuild.mjs --ids=json2csv-people
```

For new files, run `git add -N <file>` in the source checkout before creating
the diff.

Patch names match the checkout names in `scripts/corpus-rebuild.mjs`, such as
`json2csv`, `coreutils`, `ripgrep`, `ruby`, `yosys`, `llvm`, `prjtrellis`, `json-as`,
`utf-as`, `tree`, `brotli`, `wasi-lab`, `age`, and `esbuild`. Patches apply to the
pinned revision and must pass the independent corpus contract. Compiler ports
remain in `ports/`.

For vendored WAT, Rust, C wrappers or fixture edits, change the files under
`wago/corpus/`, review the changes, then run
`node scripts/corpus-source-inputs.mjs --refresh` before rebuilding. This updates
source digests; it does not change expected outputs.

Library dependency patches use `semantic-<benchmark>.patch`, for example
`semantic-kissfft.patch`. They apply after its pinned checkout and before
compilation. The retained wrapper remains independently editable.

Source archives accept patches named after their extracted folders:
`lua-5.4.6.patch`, `jq-1.8.2.patch`, `xz-5.8.4.patch`,
`sqlite-amalgamation-3530400.patch`, and `boost_1_76_0.patch`.
Use `polybench.patch` for the shared PolyBench dependency.

Archive patches use unified diff paths relative to the extracted source folder
(for example `a/src/lua.c` and `b/src/lua.c`).
