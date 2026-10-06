package api

import (
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"net/url"
	"strings"
	"unicode/utf8"
)

func strictQuery(raw string) (url.Values, error) {
	if len(raw) > 16*1024 {
		return nil, wire.Invalid("query exceeds ceiling")
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return nil, wire.Invalid("malformed query encoding")
	}
	if len(values) > 32 {
		return nil, wire.Invalid("too many query fields")
	}
	for key, list := range values {
		if len(list) != 1 || key == "" || !utf8.ValidString(key) || !utf8.ValidString(list[0]) || len(key) > 64 || len(list[0]) > 4096 || strings.ContainsRune(list[0], 0) {
			return nil, wire.Invalid("ambiguous or oversized query")
		}
		switch key {
		case "revision", "cursor", "limit", "chunk", "download", "offset", "length", "from", "until":
			if list[0] == "" {
				return nil, wire.Invalid("empty scope parameter")
			}
		}
		if (key == "revision" || key == "chunk" || key == "method") && !wire.IsHash(list[0]) {
			return nil, wire.Invalid("invalid query digest")
		}
	}
	return values, nil
}
func allowedQuery(values url.Values, keys ...string) error {
	allowed := map[string]bool{}
	for _, key := range keys {
		allowed[key] = true
	}
	for key := range values {
		if !allowed[key] {
			return wire.Invalid("unsupported query")
		}
	}
	return nil
}
func routeQuery(path string, values url.Values) error {
	parts := strings.Split(path, "/")
	if len(parts) == 4 && parts[0] == "files" && parts[2] == "chunks" {
		if !wire.IsHash(parts[1]) || !wire.IsHash(parts[3]) {
			return wire.Invalid("invalid file identity")
		}
		return allowedQuery(values, "revision")
	}
	if len(parts) == 2 && parts[0] == "methods" {
		if !wire.IsHash(parts[1]) || !wire.IsHash(values.Get("definition")) {
			return wire.Invalid("exact definition and method digests required")
		}
		return allowedQuery(values, "revision", "definition")
	}
	if len(parts) >= 2 && parts[0] == "sessions" {
		if !wire.IsIdentity(parts[1]) {
			return wire.Invalid("invalid session identity")
		}
		if len(parts) == 2 {
			return allowedQuery(values, "revision")
		}
		if len(parts) == 3 && parts[2] == "jobs" {
			return allowedQuery(values, "revision", "limit", "cursor")
		}
		return allowedQuery(values)
	}
	if path == "aggregates" || path == "overview" {
		return allowedQuery(values, "scope")
	}
	if len(parts) == 2 && parts[0] == "cohorts" {
		return allowedQuery(values, "limit", "cursor", "lane")
	}
	if path == "manifest" {
		return allowedQuery(values)
	}
	if path == "history" {
		return allowedQuery(values, "revision", "selection", "environment", "runtime", "track", "definition", "method", "configuration", "contract", "workload", "metric", "scenario", "profile", "statistic", "sort", "limit", "cursor", "from", "until")
	}
	if path == "results" {
		return allowedQuery(values, "revision", "selection", "environment", "runtime", "track", "definition", "method", "configuration", "contract", "workload", "metric", "scenario", "profile", "statistic", "sort", "limit", "cursor")
	}
	if len(parts) == 1 {
		return allowedQuery(values, "revision", "limit", "cursor")
	}
	if len(parts) == 2 {
		if !wire.IsHash(parts[1]) {
			return wire.Invalid("invalid record identity")
		}
		if parts[0] == "revisions" {
			return allowedQuery(values)
		}
		return allowedQuery(values, "revision")
	}
	if len(parts) == 3 && parts[0] == "reports" && parts[2] == "files" {
		if !wire.IsHash(parts[1]) {
			return wire.Invalid("invalid report identity")
		}
		return allowedQuery(values, "revision")
	}
	if len(parts) == 3 {
		if !wire.IsHash(parts[1]) {
			return wire.Invalid("invalid record identity")
		}
		if parts[0] == "artifacts" && parts[2] == "functions" {
			return allowedQuery(values, "revision", "limit", "cursor")
		}
		if parts[0] == "artifacts" && (parts[2] == "bytes" || parts[2] == "content") {
			return allowedQuery(values, "revision", "download", "offset", "length")
		}
		return allowedQuery(values, "revision", "chunk")
	}
	return allowedQuery(values)
}
