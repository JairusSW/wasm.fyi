package comparison

import "strings"

const CategoryVersion = "wasmfyi-workload-category-v1"

// Category mirrors the site's editorial operation classification. It is not a
// scientific measurement definition and unknown applications are never guessed.
func Category(id, category, feature string, features, tags []string) (string, bool) {
	if id == "mechanisms/host-to-wasm-call" || id == "mechanisms/wasm-to-host-call" {
		return "Host calls", true
	}
	if strings.HasPrefix(id, "features/") {
		if feature == "" && len(features) > 0 {
			feature = features[0]
		}
		if feature == "" {
			feature = "baseline"
		}
		return "Features · " + feature, true
	}
	if category != "" {
		return category, true
	}
	parts := strings.Split(id, "/")
	name := ""
	if len(parts) > 1 {
		name = parts[1]
	}
	t := map[string]bool{}
	for _, tag := range tags {
		t[tag] = true
	}
	in := func(names ...string) bool {
		for _, n := range names {
			if name == n {
				return true
			}
		}
		return false
	}
	has := func(names ...string) bool {
		for _, n := range names {
			if t[n] {
				return true
			}
		}
		return false
	}
	switch {
	case has("bioinformatics") || in("lcs-substrings", "needleman-wunsch-dna", "smith-waterman-dna", "fasttree-phylogeny", "seqtk-fastq-to-fasta", "polybench-nussinov"):
		return "Bioinformatics", true
	case has("fpga"):
		return "Hardware design", true
	case has("compiler", "formatter"):
		return "Compilers & development tools", true
	case has("interpreter") || in("wren", "wren-modulo", "lua"):
		return "Language runtimes", true
	case has("database", "sql"):
		return "Databases & analytics", true
	case has("filesystem"):
		return "Files & directories", true
	case has("search"):
		return "Search & indexing", true
	case has("json") || in("cjson"):
		return "JSON & serialization", true
	case has("xml", "text", "base64") || in("sightglass-shootout-base64", "tinyxml2"):
		return "Text & parsing", true
	case in("coreutils-sha256sum", "embench-crc32", "embench-nettle-aes", "embench-nettle-sha256", "sightglass-libsodium-hash") || has("encryption"):
		return "Hashing & cryptography", true
	case in("embench-huffbench"):
		return "Compression", true
	case in("embench-matmult-int"):
		return "Linear algebra", true
	case in("embench-qrduino"):
		return "Graphics & images", true
	case in("tacle-bsort") || has("sort"):
		return "Integer & graph algorithms", true
	case in("kissfft"):
		return "Audio", true
	case in("raytrace"):
		return "3D & rendering", true
	case in("tiny", "fib_rec", "memory", "memory_tree", "dispatch", "many_funcs", "linked_list"):
		return "Calls & memory", true
	case in("json-as", "json-as-simd", "yyjson"):
		return "JSON & serialization", true
	case in("utf-as", "utf-as-simd", "utf8proc", "fastfloat", "pcre2"):
		return "Text & parsing", true
	case in("sha256", "blake-as", "blake-as-simd") || has("hashing", "crypto"):
		return "Hashing & cryptography", true
	case has("compression"):
		return "Compression", true
	case has("audio"):
		return "Audio", true
	case has("image", "graphics", "image-processing"):
		return "Graphics & images", true
	case in("matmul") || has("linear-algebra", "blas", "solver"):
		return "Linear algebra", true
	case has("stencil"):
		return "Stencils", true
	case has("statistics"):
		return "Statistics", true
	case in("nbody", "libtommath") || has("numerical"):
		return "Numerical arithmetic", true
	case in("fannkuch", "coremark") || has("graph", "dynamic-programming"):
		return "Integer & graph algorithms", true
	}
	return "", false
}
