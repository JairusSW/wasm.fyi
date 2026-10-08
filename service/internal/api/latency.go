package api

import (
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type latencyPlatform struct {
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	CPU         string `json:"cpu"`
	Cores       int    `json:"cores"`
	Kernel      string `json:"kernel"`
	MemoryBytes int64  `json:"memoryBytes,omitempty"`
}
type latencyRow struct {
	Workload     string   `json:"workload"`
	Wasm         string   `json:"wasm"`
	Artifact     string   `json:"artifactSha256"`
	Contract     string   `json:"contractSha256"`
	Engine       string   `json:"engine"`
	Version      string   `json:"version"`
	Backend      string   `json:"backend"`
	Phase        string   `json:"phase"`
	Status       string   `json:"status"`
	Value        *float64 `json:"latencyNs"`
	PeakRSS      *float64 `json:"peakRssBytes,omitempty"`
	CodeBytes    *float64 `json:"codeBytes,omitempty"`
	MemoryStatus string   `json:"memoryStatus,omitempty"`
	CodeStatus   string   `json:"codeStatus,omitempty"`
}
type latencyCapture struct {
	Schema     int             `json:"schema"`
	CapturedAt string          `json:"capturedAt"`
	Platform   latencyPlatform `json:"platform"`
	Results    []latencyRow    `json:"results"`
}
type latencyState struct {
	mu             sync.Mutex
	directory      string
	signature      string
	captures       []latencyCapture
	legacyRevision string
	legacy         map[string][]latencyRow
}

// Compact captures remain ordinary JSON files, independent of evidence storage.
// A shared directory can be written by the local coordinator and read by the API.
func (a *API) SetLatencyDirectory(directory string) {
	a.latencies = &latencyState{directory: directory, legacy: map[string][]latencyRow{}}
}
func validateLatency(c latencyCapture) error {
	if c.Schema != 1 || len(c.Results) == 0 || len(c.Results) > 4096 {
		return wire.Invalid("invalid latency capture")
	}
	if _, err := time.Parse(time.RFC3339Nano, c.CapturedAt); err != nil {
		return wire.Invalid("invalid capture time")
	}
	if c.Platform.OS == "" || c.Platform.Arch == "" || c.Platform.CPU == "" || c.Platform.Cores < 1 || c.Platform.MemoryBytes < 0 || len(c.Platform.OS) > 64 || len(c.Platform.Arch) > 64 || len(c.Platform.CPU) > 256 || len(c.Platform.Kernel) > 512 {
		return wire.Invalid("invalid platform")
	}
	seen := map[string]bool{}
	for _, r := range c.Results {
		key := r.Workload + "|" + r.Engine + "|" + r.Phase
		if seen[key] || r.Workload == "" || len(r.Workload) > 256 || !wire.IsHash(r.Artifact) || !wire.IsHash(r.Contract) || !wire.IsIdentity(r.Engine) || len(r.Version) > 256 || len(r.Backend) > 128 || r.Wasm == "" || len(r.Wasm) > 256 || filepath.Base(r.Wasm) != r.Wasm || strings.Contains(r.Wasm, "\\") || !strings.HasSuffix(r.Wasm, ".wasm") {
			return wire.Invalid("invalid latency row")
		}
		for _, resource := range []struct {
			value  *float64
			status string
		}{{r.PeakRSS, r.MemoryStatus}, {r.CodeBytes, r.CodeStatus}} {
			switch resource.status {
			case "", "ok", "failed", "unsupported", "disabled", "not-measured":
			default:
				return wire.Invalid("invalid resource status")
			}
			if resource.status == "ok" && resource.value == nil || resource.status != "ok" && resource.value != nil {
				return wire.Invalid("invalid resource value")
			}
			if resource.value != nil && (*resource.value < 0 || math.IsNaN(*resource.value) || math.IsInf(*resource.value, 0)) {
				return wire.Invalid("invalid resource value")
			}
		}
		seen[key] = true
		if !latencyPhase(r.Phase) {
			return wire.Invalid("invalid latency phase")
		}
		switch r.Status {
		case "ok", "failed", "unsupported", "disabled", "not-measured":
		default:
			return wire.Invalid("invalid latency status")
		}
		if r.Status == "ok" && (r.Value == nil || *r.Value < 0 || math.IsNaN(*r.Value) || math.IsInf(*r.Value, 0)) || r.Status != "ok" && r.Value != nil {
			return wire.Invalid("failed cells must not carry latency")
		}
	}
	return nil
}
func latencyPhase(p string) bool {
	return p == "compile" || p == "instantiate" || p == "first-call" || p == "steady"
}
func platformID(p latencyPlatform) string { b, _ := json.Marshal(p); return wire.Hash(b) }
func (a *API) publishLatency(w http.ResponseWriter, r *http.Request) {
	if a.latencies == nil || a.latencies.directory == "" {
		problem(w, r, wire.Invalid("latency publication directory is not configured"))
		return
	}
	var capture latencyCapture
	if err := decode(w, r, &capture); err != nil {
		problem(w, r, err)
		return
	}
	if err := validateLatency(capture); err != nil {
		problem(w, r, err)
		return
	}
	b, _ := json.Marshal(capture)
	keys := []string{}
	for _, row := range capture.Results {
		keys = append(keys, row.Workload+"|"+row.Engine+"|"+row.Phase)
	}
	sort.Strings(keys)
	p := capture.Platform
	identity := []any{p.OS, p.Arch, p.CPU, p.Cores, p.Kernel, p.MemoryBytes}
	for _, key := range keys {
		identity = append(identity, key)
	}
	identityBytes, _ := json.Marshal(identity)
	id := wire.Hash(identityBytes)
	a.latencies.mu.Lock()
	defer a.latencies.mu.Unlock()
	directory := a.latencies.directory
	if err := os.MkdirAll(directory, 0700); err != nil {
		problem(w, r, err)
		return
	}
	f, err := os.CreateTemp(directory, ".capture-*")
	if err != nil {
		problem(w, r, err)
		return
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, filepath.Join(directory, id+".json"))
	}
	if err != nil {
		problem(w, r, err)
		return
	}
	a.latencies.signature = ""
	respond(w, r, 201, map[string]string{"id": id}, false)
}
func (s *latencyState) load() ([]latencyCapture, string, error) {
	entries, err := os.ReadDir(s.directory)
	if os.IsNotExist(err) || s.directory == "" {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	names := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	if len(names) > 10000 {
		return nil, "", store.ErrLimit
	}
	sort.Strings(names)
	metadata := []string{}
	for _, name := range names {
		info, e := os.Lstat(filepath.Join(s.directory, name))
		if e != nil {
			return nil, "", e
		}
		metadata = append(metadata, name+strconv.FormatInt(info.ModTime().UnixNano(), 10)+strconv.FormatInt(info.Size(), 10))
	}
	signature := wire.Hash([]byte(strings.Join(metadata, "\n")))
	if signature == s.signature {
		return s.captures, signature, nil
	}
	captures := []latencyCapture{}
	totalRows, totalBytes := 0, int64(0)
	for _, name := range names {
		path := filepath.Join(s.directory, name)
		info, err := os.Lstat(path)
		if err != nil {
			return nil, "", err
		}
		totalBytes += info.Size()
		if !info.Mode().IsRegular() || info.Size() > wire.ResponseBytes || totalBytes > 64*1024*1024 {
			return nil, "", store.ErrLimit
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, "", err
		}
		var c latencyCapture
		if err = wire.Decode(b, &c); err != nil {
			return nil, "", err
		}
		if err = validateLatency(c); err != nil {
			return nil, "", err
		}
		totalRows += len(c.Results)
		if totalRows > 100000 {
			return nil, "", store.ErrLimit
		}
		captures = append(captures, c)
	}
	s.signature, s.captures = signature, captures
	return captures, signature, nil
}
func (a *API) latency(w http.ResponseWriter, r *http.Request) {
	if a.latencies == nil {
		a.SetLatencyDirectory("")
	}
	s := a.latencies
	s.mu.Lock()
	defer s.mu.Unlock()
	params := r.URL.Query()
	phase := params.Get("phase")
	if phase != "" && !latencyPhase(phase) {
		problem(w, r, wire.Invalid("invalid latency phase"))
		return
	}
	n, err := limit(r)
	if err != nil {
		problem(w, r, err)
		return
	}
	offset := 0
	if raw := params.Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 {
			problem(w, r, wire.Invalid("invalid offset"))
			return
		}
	}
	captures, revision, err := s.load()
	if err != nil {
		problem(w, r, err)
		return
	}
	platforms := map[string]latencyPlatform{}
	for _, c := range captures {
		platforms[platformID(c.Platform)] = c.Platform
	}
	anchors := map[string][]string{}
	legacyRevision := a.Store.Current()
	if len(captures) == 0 && legacyRevision != "" {
		records, err := a.Store.CatalogContext(r.Context(), legacyRevision, "environment")
		if err != nil {
			problem(w, r, err)
			return
		}
		for _, record := range records {
			var host struct {
				OS     string `json:"os"`
				Arch   string `json:"arch"`
				CPU    string `json:"cpu_description"`
				Cores  int    `json:"logical_cpus"`
				Kernel string `json:"kernel"`
			}
			if err = json.Unmarshal(record.Data, &host); err != nil {
				problem(w, r, err)
				return
			}
			p := latencyPlatform{OS: host.OS, Arch: host.Arch, CPU: host.CPU, Cores: host.Cores, Kernel: host.Kernel}
			id := platformID(p)
			platforms[id] = p
			anchors[id] = append(anchors[id], record.ID)
		}
		revision = legacyRevision
	}
	ids := []string{}
	for id := range platforms {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	selected := params.Get("platform")
	if selected == "" && len(ids) > 0 {
		selected = ids[0]
	}
	if selected != "" {
		if _, ok := platforms[selected]; !ok {
			problem(w, r, store.ErrNotFound)
			return
		}
	}
	if pin := params.Get("revision"); pin != "" && pin != revision {
		problem(w, r, store.ErrProgressChanged)
		return
	}
	rows := []latencyRow{}
	if len(captures) > 0 {
		sort.Slice(captures, func(i, j int) bool {
			a, _ := time.Parse(time.RFC3339Nano, captures[i].CapturedAt)
			b, _ := time.Parse(time.RFC3339Nano, captures[j].CapturedAt)
			return a.Before(b)
		})
		latest := map[string]latencyRow{}
		for _, c := range captures {
			if platformID(c.Platform) != selected {
				continue
			}
			for _, row := range c.Results {
				latest[row.Workload+"|"+row.Engine+"|"+row.Phase] = row
			}
		}
		for _, row := range latest {
			rows = append(rows, row)
		}
	} else if len(anchors[selected]) > 0 {
		if s.legacyRevision != legacyRevision {
			s.legacy = map[string][]latencyRow{}
			s.legacyRevision = legacyRevision
		}
		cached, ok := s.legacy[selected]
		if !ok {
			environments := anchors[selected]
			records, err := a.resultRows(r.Context(), store.Query{Revision: legacyRevision, Environment: environments[0], Environments: environments, Selection: "current", Metric: "time.wall", Profile: "timing", Statistic: "median_ns_per_operation", Sort: "catalog"}, false)
			if err != nil {
				problem(w, r, err)
				return
			}
			workloads := map[string]map[string]any{}
			configurations := map[string]map[string]any{}
			latest := map[string]latencyRow{}
			latestTime := map[string]time.Time{}
			for _, record := range records {
				var result wire.Result
				if err = json.Unmarshal(record.Data, &result); err != nil {
					problem(w, r, err)
					return
				}
				if !latencyPhase(result.Scenario) {
					continue
				}
				for _, lookup := range []struct {
					kind, id string
					cache    map[string]map[string]any
				}{{"workload", result.ContractID, workloads}, {"configuration", result.ConfigurationID, configurations}} {
					if _, ok := lookup.cache[lookup.id]; !ok {
						canonical, e := a.Store.Record(legacyRevision, lookup.kind, lookup.id)
						if e != nil {
							problem(w, r, e)
							return
						}
						var d map[string]any
						_ = json.Unmarshal(canonical.Data, &d)
						lookup.cache[lookup.id] = d
					}
				}
				contract := workloads[result.ContractID]
				if contract["abi"] == "wasi-command" || strings.HasPrefix(result.Workload, "features/wasi-") {
					continue
				}
				cfg := configurations[result.ConfigurationID]
				sha, _ := contract["sha256"].(string)
				name := sha + ".wasm"
				if original, ok := contract["original_contract"].(map[string]any); ok {
					if artifact, ok := original["artifact"].(string); ok {
						name = filepath.Base(artifact)
					}
				}
				engine, _ := cfg["id"].(string)
				version, _ := cfg["version"].(string)
				backend, _ := cfg["backend"].(string)
				if description, ok := cfg["description"].(map[string]any); ok {
					if value, ok := description["runtime_version"].(string); ok {
						version = value
					}
					if value, ok := description["backend"].(string); ok {
						backend = value
					}
				}
				var summary struct {
					Value    *float64       `json:"median_ns_per_operation"`
					Outcomes map[string]int `json:"outcomes"`
				}
				if err = json.Unmarshal(result.Summary, &summary); err != nil {
					problem(w, r, err)
					return
				}
				status := "not-measured"
				if summary.Value != nil {
					status = "ok"
				}
				for outcome, count := range summary.Outcomes {
					if count > 0 && outcome != "ok" {
						if outcome == "unsupported" && status == "not-measured" {
							status = "unsupported"
						} else if outcome != "unsupported" {
							status = "failed"
							summary.Value = nil
						}
					}
				}
				if result.Workload == "mechanisms/wasm-host-wasm-loop" && result.Scenario == "steady" && summary.Value != nil {
					value := *summary.Value / 1000000
					summary.Value = &value
				}
				key := result.Workload + "|" + engine + "|" + result.Scenario
				if stamp, ok := latestTime[key]; !ok || result.Created.After(stamp) {
					latestTime[key] = result.Created
					latest[key] = latencyRow{Workload: result.Workload, Wasm: name, Artifact: sha, Contract: result.ContractID, Engine: engine, Version: version, Backend: backend, Phase: result.Scenario, Status: status, Value: summary.Value}
				}
			}
			for _, row := range latest {
				cached = append(cached, row)
			}
			s.legacy[selected] = cached
		}
		rows = cached
	}
	filtered := []latencyRow{}
	for _, row := range rows {
		if phase == "" || row.Phase == phase {
			filtered = append(filtered, row)
		}
	}
	sort.Slice(filtered, func(i, j int) bool {
		a, b := filtered[i], filtered[j]
		return a.Workload+"|"+a.Engine+"|"+a.Phase < b.Workload+"|"+b.Engine+"|"+b.Phase
	})
	if offset > len(filtered) {
		problem(w, r, wire.Invalid("offset exceeds rows"))
		return
	}
	end := min(offset+n, len(filtered))
	next := 0
	if end < len(filtered) {
		next = end
	}
	choices := []map[string]any{}
	for _, id := range ids {
		b, _ := json.Marshal(platforms[id])
		p := map[string]any{}
		_ = json.Unmarshal(b, &p)
		p["id"] = id
		choices = append(choices, p)
	}
	respond(w, r, 200, map[string]any{"schema": 1, "revision": revision, "platform": selected, "platforms": choices, "items": filtered[offset:end], "total": len(filtered), "nextOffset": next, "complete": end == len(filtered)}, false)
}
