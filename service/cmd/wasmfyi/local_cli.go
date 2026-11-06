package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

type localStrings []string

type localRepeated localStrings

func (s *localRepeated) String() string { return strings.Join(*s, ", ") }
func (s *localRepeated) Set(value string) error {
	if value == "" {
		return fmt.Errorf("empty value")
	}
	*s = append(*s, value)
	return nil
}

func (s *localStrings) String() string { return strings.Join(*s, ",") }
func (s *localStrings) Set(value string) error {
	for _, v := range strings.Split(value, ",") {
		if v == "" {
			return fmt.Errorf("empty selection")
		}
		*s = append(*s, v)
	}
	return nil
}

type localOptions struct {
	Engines      localStrings `json:"engines"`
	Corpora      localStrings `json:"corpora"`
	Sources      localStrings `json:"sources"`
	Artifacts    localStrings `json:"artifacts"`
	Contracts    localStrings `json:"contracts"`
	Cache        string       `json:"cache"`
	Mode         string       `json:"mode"`
	Timeout      string       `json:"timeout"`
	TimeoutMS    int64        `json:"timeoutMs"`
	Samples      int          `json:"samples"`
	Offline      bool         `json:"offline"`
	DryRun       bool         `json:"dryRun"`
	SourceDigest string       `json:"sourceDigest,omitempty"`
	Data         string       `json:"-"`
	Site         string       `json:"-"`
	ID           string       `json:"-"`
	Baseline     string       `json:"-"`
	Port         int          `json:"-"`
	Frontend     string       `json:"-"`
	NoServe      bool         `json:"-"`
	Rerun        bool         `json:"rerun"`
	JSON         bool         `json:"-"`
}
type localJob struct {
	Key      string   `json:"key"`
	CacheKey string   `json:"cacheKey"`
	Engine   string   `json:"engine"`
	Workload string   `json:"workload"`
	Requires []string `json:"requires,omitempty"`
}
type localPlan struct {
	Prepared bool       `json:"prepared"`
	Rerun    bool       `json:"rerun"`
	Schema   int        `json:"schema"`
	Created  string     `json:"created"`
	Cache    string     `json:"cache"`
	Jobs     []localJob `json:"jobs"`
	Engines  []struct {
		ID string `json:"id"`
	} `json:"engines"`
	Workloads []struct {
		ID string `json:"id"`
	} `json:"workloads"`
	TimeoutMS int64                      `json:"timeoutMs"`
	Raw       map[string]json.RawMessage `json:"-"`
}
type localEvent struct {
	Event    string           `json:"event"`
	Engine   string           `json:"engine,omitempty"`
	Message  string           `json:"message,omitempty"`
	Key      string           `json:"key,omitempty"`
	CacheKey string           `json:"cacheKey,omitempty"`
	Plan     json.RawMessage  `json:"plan,omitempty"`
	Capture  *benchdb.Capture `json:"capture,omitempty"`
	Engines  json.RawMessage  `json:"engines,omitempty"`
	Corpora  json.RawMessage  `json:"corpora,omitempty"`
	Builds   []struct {
		ID         string `json:"id"`
		Adapter    string `json:"adapterSha256"`
		Controller string `json:"controllerSha256"`
	} `json:"builds,omitempty"`
}

func localDefaults() (data, cache string) {
	d, _ := os.UserConfigDir()
	c, _ := os.UserCacheDir()
	return filepath.Join(d, "wasmfyi"), filepath.Join(c, "wasmfyi")
}
func localStyle(code, text string) string {
	info, e := os.Stdout.Stat()
	if e != nil || info.Mode()&os.ModeCharDevice == 0 || os.Getenv("NO_COLOR") != "" || os.Getenv("TERM") == "dumb" {
		return text
	}
	return "\x1b[" + code + "m" + text + "\x1b[0m"
}
func localHelp(command string) {
	if command == "" {
		fmt.Printf("%s — WebAssembly benchmarks on your machine\n\n%s wasmfyi <command> [flags]\n\n%s\n", localStyle("1", "wasmfyi"), localStyle("1", "Usage:"), localStyle("1", "Commands:"))
		for _, r := range [][2]string{{"bench", "measure selected engines and corpora"}, {"test", "check selected feature compatibility"}, {"serve", "serve local results; serve stop stops a managed preview"}, {"engines", "list engine/backend selectors"}, {"corpora", "list workload selectors"}, {"runs [run]", "show captures and progress"}, {"compare <before> <after>", "compare matching workload measurements"}, {"resume <run>", "continue an interrupted capture"}, {"stop <run>", "stop your capture and retain checkpoints"}, {"cache [prune]", "inspect or prune unused build artifacts"}, {"doctor", "check local prerequisites"}, {"version", "show version information"}} {
			fmt.Printf("  %-26s %s\n", r[0], r[1])
		}
		fmt.Print("\nFlags:\n  --data <directory>         local SQLite dataset\n  --cache <directory>        reusable source and build cache\n  --json                     machine-readable output\n\nUse wasmfyi <command> --help for flags and examples.\n")
		return
	}
	fmt.Printf("%s wasmfyi %s [flags]\n\nFlags:\n", localStyle("1", "Usage:"), command)
	if command == "bench" || command == "test" {
		fmt.Print("  --engines, -e <ids>       comma-separated or repeated engine/backend selectors\n  --corpora, -c <ids>       workload IDs or prefixes (default: main)\n  --source <engine=path>    snapshot a local runtime checkout\n  --id <name>               name the run\n  --baseline <run>          compare against an earlier run when finished\n  --rerun                   capture fresh samples instead of linking a match\n  --samples <n>             fixed samples; compile/instantiate capped at 10\n  --timeout <duration>      workload deadline (default: 5m)\n  --artifact <id=sha256>     require the exact Wasm input from a copied command\n  --contract <id=sha256>     require the exact input/output contract\n  --source-digest <sha256>   require an exact local source snapshot\n  --offline                 require cached sources and tools\n  --dry-run                 print the selection without building or measuring\n  --no-serve                save results without starting the local website\n  --port, -p <port>          local preview port (default: 8788)\n  --help-sampling           describe the sampling policy\n")
	}
	if command == "serve" {
		fmt.Print("  --port, -p <port>          loopback port (default: 8788; 0 chooses a free port)\n  --background              start a managed preview\n  --frontend <directory>    use an existing frontend build\n\n  wasmfyi serve stop        stop only a CLI-managed preview\n")
	}
	fmt.Print("  --data <directory>        use another local SQLite dataset\n  --cache <directory>       use another source/build cache\n  --workspace <directory>   use an explicit wasm.fyi source/distribution root\n  --json                    machine-readable output\n  --help, -h                show help\n")
	if command == "bench" || command == "test" {
		fmt.Print("\nExamples:\n  wasmfyi bench -e wago-railshot,wazero-wazevo -c applications/image-blur\n  wasmfyi bench -e wago-railshot --source wago-railshot=../wago --id after --baseline before\n  wasmfyi test -e wasmtime-cranelift -c features/core-num\n")
	}
}
func localWorkspace(explicit string) (string, error) {
	var candidates []string
	if explicit != "" {
		candidates = []string{explicit}
	} else {
		if e := os.Getenv("WASMFYI_ROOT"); e != "" {
			candidates = append(candidates, e)
		}
		exe, _ := os.Executable()
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "share", "wasmfyi"), filepath.Join(filepath.Dir(exe), "..", "share", "wasmfyi"))
		cwd, _ := os.Getwd()
		for p := cwd; ; p = filepath.Dir(p) {
			candidates = append(candidates, p)
			if filepath.Dir(p) == p {
				break
			}
		}
		_, file, _, _ := runtime.Caller(0)
		candidates = append(candidates, filepath.Join(filepath.Dir(file), "..", "..", ".."))
	}
	for _, p := range candidates {
		p, _ = filepath.Abs(p)
		if _, err := os.Stat(filepath.Join(p, "scripts", "local", "worker.mjs")); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("CLI worker assets not found; install with just install-cli or set WASMFYI_ROOT to your wasm.fyi checkout")
}
func localWorker(ctx context.Context, site string, args []string, locked bool, consume func(localEvent) error) error {
	node := os.Getenv("WASMFYI_NODE")
	if node == "" {
		node = "node"
	}
	arguments := append([]string{filepath.Join(site, "scripts", "local", "worker.mjs")}, args...)
	program := node
	if locked {
		home, _ := os.UserHomeDir()
		wrapper := filepath.Join(home, "benchmark-lock.py")
		if _, err := os.Stat(wrapper); err == nil {
			program = "python3"
			arguments = append([]string{wrapper, "--wait", "--owner", "wasmfyi: local capture", "--", node}, arguments...)
		}
	}
	cmd := exec.CommandContext(ctx, program, arguments...)
	cmd.Dir = site
	cmd.Stderr = os.Stderr
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return terminateLocalTree(cmd.Process.Pid) }
	cmd.WaitDelay = 5 * time.Second
	if err = cmd.Start(); err != nil {
		return err
	}
	scanner := bufio.NewScanner(pipe)
	scanner.Buffer(make([]byte, 65536), 16<<20)
	var eventError error
	for scanner.Scan() {
		line := scanner.Bytes()
		var e localEvent
		if json.Unmarshal(line, &e) != nil || e.Event == "" {
			fmt.Fprintln(os.Stderr, string(line))
			continue
		}
		if e.Event == "error" {
			eventError = errors.New(e.Message)
		}
		if consume != nil {
			if err := consume(e); err != nil {
				eventError = err
				_ = terminateLocalTree(cmd.Process.Pid)
				break
			}
		}
	}
	err = cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if eventError != nil {
		return eventError
	}
	if scanner.Err() != nil {
		return scanner.Err()
	}
	return err
}
func localFile(cache string, value any) (string, func(), error) {
	if err := os.MkdirAll(filepath.Join(cache, "runtime"), 0700); err != nil {
		return "", nil, err
	}
	f, err := os.CreateTemp(filepath.Join(cache, "runtime"), "request-*.json")
	if err != nil {
		return "", nil, err
	}
	name := f.Name()
	err = json.NewEncoder(f).Encode(value)
	f.Close()
	return name, func() { os.Remove(name) }, err
}
func localDB(ctx context.Context, data string) (*sqldb.Store, error) {
	if err := os.MkdirAll(data, 0700); err != nil {
		return nil, err
	}
	db, err := sqldb.Open(data)
	if err != nil {
		return nil, err
	}
	if err = db.EnsureLocalRuns(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
func localPrint(jsonMode bool, value any, format string, args ...any) {
	if jsonMode {
		_ = json.NewEncoder(os.Stdout).Encode(value)
	} else {
		fmt.Printf(format, args...)
	}
}
func localIdentifier(s string) bool {
	if len(s) == 0 || len(s) > 100 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.') {
			return false
		}
	}
	return s != "." && s != ".."
}
func localCLI(ctx context.Context, args []string) (bool, error) {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		command := ""
		if len(args) > 1 {
			command = args[1]
		}
		localHelp(command)
		return true, nil
	}
	if args[0] == "version" || args[0] == "--version" || args[0] == "-v" {
		fmt.Println("wasmfyi local-cli/1")
		return true, nil
	}
	action := args[0]
	known := map[string]bool{"bench": true, "test": true, "engines": true, "corpora": true, "runs": true, "resume": true, "stop": true, "compare": true, "cache": true, "doctor": true, "serve": true}
	if !known[action] {
		return false, nil
	}
	if action == "serve" {
		for _, arg := range args[1:] {
			name := strings.SplitN(strings.TrimLeft(arg, "-"), "=", 2)[0]
			if name == "listen" || name == "storage" || name == "read-only" || name == "trusted-proxies" || strings.HasPrefix(name, "public-") || strings.HasPrefix(name, "max-") || strings.HasPrefix(name, "tls-") || name == "latency-data" || name == "page-data" || name == "startup-verification" {
				return false, nil
			}
		}
	}
	for _, arg := range args[1:] {
		if arg == "--help" || arg == "-h" {
			localHelp(action)
			return true, nil
		}
		if arg == "--help-sampling" {
			fmt.Println("One process; ordered groups of 5; no warmups. Stabilize at ≤5% relative standard deviation and ≤3% relative drift. Compile/instantiate cap: 10; execution/calls cap: 25. Fixed --samples uses min(n, phase cap). RSS/code use available resource observations. Raw sample order and settling metadata are retained.")
			return true, nil
		}
	}
	data, cache := localDefaults()
	o := localOptions{Data: data, Cache: cache, Port: 8788, Timeout: "5m", Mode: action}
	fs := flag.NewFlagSet("wasmfyi "+action, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.Var(&o.Engines, "engines", "")
	fs.Var(&o.Engines, "engine", "")
	fs.Var(&o.Engines, "e", "")
	fs.Var(&o.Corpora, "corpora", "")
	fs.Var(&o.Corpora, "corpus", "")
	fs.Var(&o.Corpora, "c", "")
	fs.Var((*localRepeated)(&o.Sources), "source", "")
	fs.Var(&o.Artifacts, "artifact", "")
	fs.Var(&o.Contracts, "contract", "")
	fs.StringVar(&o.SourceDigest, "source-digest", "", "")
	fs.StringVar(&o.Data, "data", data, "")
	fs.StringVar(&o.Cache, "cache", cache, "")
	fs.StringVar(&o.Site, "workspace", "", "")
	fs.StringVar(&o.ID, "id", "", "")
	fs.StringVar(&o.Baseline, "baseline", "", "")
	fs.StringVar(&o.Timeout, "timeout", "5m", "")
	fs.IntVar(&o.Samples, "samples", 0, "")
	fs.IntVar(&o.Port, "port", 8788, "")
	fs.IntVar(&o.Port, "p", 8788, "")
	fs.BoolVar(&o.Rerun, "rerun", false, "")
	fs.BoolVar(&o.NoServe, "no-serve", false, "")
	fs.BoolVar(&o.Offline, "offline", false, "")
	fs.BoolVar(&o.DryRun, "dry-run", false, "")
	fs.BoolVar(&o.JSON, "json", false, "")
	background := fs.Bool("background", false, "")
	frontend := fs.String("frontend", "", "")
	if err := fs.Parse(localFlagOrder(fs, args[1:])); err != nil {
		return true, fmt.Errorf("%w; use wasmfyi %s --help", err, action)
	}
	if (action == "bench" || action == "test") && fs.NArg() != 0 {
		return true, fmt.Errorf("unexpected positional selection; use --engines and --corpora")
	}
	o.Data, _ = filepath.Abs(o.Data)
	o.Cache, _ = filepath.Abs(o.Cache)
	site, err := localWorkspace(o.Site)
	if err != nil && action != "runs" && action != "compare" && action != "stop" && action != "cache" {
		return true, err
	}
	o.Site = site
	if action == "bench" || action == "test" || action == "resume" || (action == "cache" && fs.NArg() > 0 && fs.Arg(0) == "prune") {
		release, e := localCacheLease(o.Cache)
		if e != nil {
			return true, e
		}
		defer release()
	}
	if o.Port < 0 || o.Port > 65535 {
		return true, fmt.Errorf("port must be between 0 and 65535")
	}
	if action == "serve" {
		o.Frontend = *frontend
		return true, localServe(ctx, o, *frontend, *background, fs.Args())
	}
	if action == "doctor" {
		for _, tool := range []string{"node", "git", "go", "cargo", "cc"} {
			path, e := exec.LookPath(tool)
			if e != nil {
				path = "not installed"
			}
			fmt.Printf("  %-12s %s\n", tool, path)
		}
		fmt.Printf("  %-12s %s\n  %-12s %s\n", "data", o.Data, "workspace", site)
		return true, nil
	}
	if action == "cache" {
		return true, localCache(o, fs.Args())
	}
	if action == "engines" || action == "corpora" {
		return true, localCatalogue(ctx, o, action, fs.Args())
	}
	var db *sqldb.Store
	if !o.DryRun {
		db, err = localDB(ctx, o.Data)
		if err != nil {
			return true, err
		}
		defer db.Close()
	} else if action != "bench" && action != "test" {
		return true, fmt.Errorf("--dry-run is only available for bench and test")
	}
	switch action {
	case "runs":
		if fs.NArg() == 0 {
			runs, e := db.LocalRuns(ctx)
			if e != nil {
				return true, e
			}
			if o.JSON {
				return true, json.NewEncoder(os.Stdout).Encode(runs)
			}
			for _, r := range runs {
				fmt.Printf("  %-30s %-12s %4d workloads  %s\n", r.ID, r.Status, r.Completed, r.Created)
			}
			return true, nil
		}
		r, e := db.LocalRun(ctx, fs.Arg(0))
		if e != nil {
			return true, e
		}
		if o.JSON {
			return true, json.NewEncoder(os.Stdout).Encode(r)
		}
		fmt.Printf("Run: %s · %s\n  %d completed engine/workload pairs · %s\n", r.ID, r.Status, r.Completed, r.Created)
		if r.Error != "" {
			fmt.Println(r.Error)
		}
		if preview, ok := previewIdentity(o.Data); ok {
			fmt.Printf("  %s/runs/%s\n", preview.URL, r.ID)
		}
		values, e := db.LocalValues(ctx, r.ID)
		if e != nil {
			return true, e
		}
		for _, v := range values {
			measurement := v.Status
			if v.Latency != nil {
				measurement = localLatency(*v.Latency)
			}
			fmt.Printf("  %-20s %-40s %-12s %s\n", v.Engine, v.Workload, v.Phase, measurement)
		}
		return true, nil
	case "compare":
		if fs.NArg() != 2 {
			return true, fmt.Errorf("compare requires two run IDs")
		}
		return true, localCompare(ctx, db, fs.Arg(0), fs.Arg(1), o.JSON)
	case "stop":
		if fs.NArg() != 1 {
			return true, fmt.Errorf("stop requires one run ID")
		}
		return true, stopLocalCapture(o.Data, fs.Arg(0))
	case "resume":
		if fs.NArg() != 1 {
			return true, fmt.Errorf("resume requires one run ID")
		}
		r, e := db.LocalRun(ctx, fs.Arg(0))
		if e != nil {
			return true, e
		}
		return true, executeLocalPlan(ctx, db, o, r.ID, r.Plan)
	}
	if len(o.Engines) == 0 {
		info, _ := os.Stdin.Stat()
		if info == nil || info.Mode()&os.ModeCharDevice == 0 {
			return true, fmt.Errorf("select engines with --engines; see wasmfyi engines")
		}
		fmt.Fprint(os.Stderr, "Engines (comma-separated, e.g. wago-railshot,wazero-wazevo): ")
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		if err := o.Engines.Set(strings.TrimSpace(line)); err != nil {
			return true, err
		}
	}
	if action == "test" && len(o.Corpora) == 0 {
		o.Corpora = []string{"features"}
	}
	d, err := time.ParseDuration(o.Timeout)
	if err != nil || d <= 0 || d > 5*time.Minute {
		return true, fmt.Errorf("timeout must be positive and at most 5m")
	}
	o.TimeoutMS = d.Milliseconds()
	if o.Samples < 0 || o.Samples > 25 {
		return true, fmt.Errorf("samples must be between 1 and 25, or omitted for adaptive sampling")
	}
	request, cleanup, err := localFile(o.Cache, o)
	if err != nil {
		return true, err
	}
	defer cleanup()
	var plan json.RawMessage
	err = localWorker(ctx, site, []string{"prepare", request}, false, func(e localEvent) error {
		if e.Event == "result" {
			plan = e.Plan
		} else if e.Event == "preparing" {
			localPrint(o.JSON, e, "Preparing %s…\n", e.Engine)
		}
		return nil
	})
	if err != nil {
		return true, err
	}
	if len(plan) == 0 {
		return true, fmt.Errorf("worker returned no benchmark plan")
	}
	if o.DryRun {
		var value any
		_ = json.Unmarshal(plan, &value)
		return true, json.NewEncoder(os.Stdout).Encode(value)
	}
	id := o.ID
	if id == "" {
		id = "local-" + time.Now().UTC().Format("20060102-150405")
	}
	if !localIdentifier(id) {
		return true, fmt.Errorf("invalid run ID")
	}
	if err = db.CreateLocalRun(ctx, id, plan); err != nil {
		return true, err
	}
	return true, executeLocalPlan(ctx, db, o, id, plan)
}

func localCatalogue(ctx context.Context, o localOptions, action string, filters []string) error {
	return localWorker(ctx, o.Site, []string{"catalogue"}, false, func(e localEvent) error {
		if e.Event != "result" {
			return nil
		}
		raw := e.Engines
		if action == "corpora" {
			raw = e.Corpora
		}
		if o.JSON {
			fmt.Println(string(raw))
			return nil
		}
		var rows []map[string]any
		if err := json.Unmarshal(raw, &rows); err != nil {
			return err
		}
		for _, r := range rows {
			id, _ := r["id"].(string)
			if len(filters) > 0 && !strings.HasPrefix(id, filters[0]) {
				continue
			}
			if action == "engines" {
				fmt.Printf("  %-28s %-22s %s\n", id, r["engine"], r["repository"])
			} else {
				fmt.Printf("  %s\n", id)
			}
		}
		return nil
	})
}
func executeLocalPlan(ctx context.Context, db *sqldb.Store, o localOptions, id string, raw json.RawMessage) (retErr error) {
	var plan localPlan
	if err := json.Unmarshal(raw, &plan); err != nil {
		return err
	}
	if len(plan.Jobs) == 0 || len(plan.Jobs) > 100000 {
		return fmt.Errorf("invalid local workload plan")
	}
	if o.Site == "" {
		var err error
		o.Site, err = localWorkspace("")
		if err != nil {
			return err
		}
	}
	runtimeDir := filepath.Join(o.Data, "runtime")
	if err := os.MkdirAll(runtimeDir, 0700); err != nil {
		return err
	}
	lockPath := filepath.Join(runtimeDir, "capture.json")
	release, err := localNamedLease(filepath.Join(runtimeDir, "capture.lock"))
	if err != nil {
		return fmt.Errorf("another capture owns this dataset: %w", err)
	}
	defer release()
	identity := newLocalIdentity(id)
	encoded, _ := json.Marshal(identity)
	if err = os.WriteFile(lockPath, encoded, 0600); err != nil {
		return err
	}
	defer os.Remove(lockPath)
	defer func() {
		if retErr != nil {
			status := "failed"
			if ctx.Err() != nil {
				status = "paused"
			}
			_ = db.SetLocalRunStatus(context.Background(), id, status, retErr.Error())
		}
	}()
	localPrint(o.JSON, map[string]any{"event": "run", "id": id, "workloads": len(plan.Jobs)}, "Run: %s · %d engine/workload pairs\n", id, len(plan.Jobs))
	file, cleanup, err := localFile(plan.Cache, json.RawMessage(raw))
	if err != nil {
		return err
	}
	defer cleanup()
	if !plan.Prepared {
		err = localWorker(ctx, o.Site, []string{"build", file}, false, func(e localEvent) error {
			if e.Event == "preparing" {
				localPrint(o.JSON, e, "Preparing %s…\n", e.Engine)
			}
			if e.Event == "result" {
				for _, b := range e.Builds {
					for i, j := range plan.Jobs {
						if j.Engine == b.ID {
							sum := sha256.Sum256([]byte(j.CacheKey + b.Adapter + b.Controller))
							plan.Jobs[i].CacheKey = hex.EncodeToString(sum[:])
						}
					}
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		var object map[string]json.RawMessage
		if err = json.Unmarshal(raw, &object); err != nil {
			return err
		}
		object["jobs"], _ = json.Marshal(plan.Jobs)
		object["prepared"] = json.RawMessage("true")
		raw, _ = json.Marshal(object)
		if err = db.FinalizeLocalPlan(ctx, id, raw); err != nil {
			return err
		}
		if err = os.WriteFile(file, raw, 0600); err != nil {
			return err
		}
	}
	if err = db.SetLocalRunStatus(ctx, id, "running", ""); err != nil {
		return err
	}
	failed := false
	notes := ""
	for index, job := range plan.Jobs {
		if err = ctx.Err(); err != nil {
			return err
		}
		done, e := db.LocalJobDone(ctx, id, job.Key)
		if e != nil {
			return e
		}
		if done {
			continue
		}
		action := "capture"
		for _, prerequisite := range job.Requires {
			passed, e := db.LocalJobPassed(ctx, id, prerequisite)
			if e != nil {
				return e
			}
			if !passed {
				action = "skip"
				break
			}
		}
		if action == "capture" && !o.Rerun && !plan.Rerun {
			reused, e := db.ReuseLocalJob(ctx, id, job.Key, job.CacheKey)
			if e != nil {
				return e
			}
			if reused {
				localPrint(o.JSON, map[string]any{"event": "reused", "engine": job.Engine, "workload": job.Workload}, "  %-24s %d/%d linked · %s\n", job.Engine, index+1, len(plan.Jobs), job.Workload)
				continue
			}
		}
		received := false
		err = localWorker(ctx, o.Site, []string{action, file, job.Key}, action == "capture", func(e localEvent) error {
			if e.Event == "diagnostic" {
				fmt.Fprintln(os.Stderr, "  "+e.Message)
				if len(notes) < 8192 {
					notes += job.Engine + " / " + job.Workload + ": " + e.Message + "\n"
					if len(notes) > 8192 {
						notes = notes[:8192]
					}
				}
			}
			if e.Event == "capture" {
				if e.Key != job.Key || e.CacheKey != job.CacheKey || e.Capture == nil {
					return fmt.Errorf("worker capture does not belong to the selected job")
				}
				if len(e.Capture.Results) == 0 {
					return fmt.Errorf("empty workload capture")
				}
				for _, row := range e.Capture.Results {
					if row.Workload != job.Workload {
						return fmt.Errorf("worker returned an unselected workload")
					}
					if row.Status == "failed" {
						failed = true
					}
				}
				cacheKey := job.CacheKey
				if action == "skip" {
					cacheKey += ":compatibility-blocked"
				}
				if err := db.PutLocalCapture(ctx, id, job.Key, cacheKey, *e.Capture); err != nil {
					return err
				}
				received = true
				localPrint(o.JSON, map[string]any{"event": "captured", "engine": job.Engine, "workload": job.Workload, "completed": index + 1, "total": len(plan.Jobs)}, "  %-24s %d/%d captured · %s\n", job.Engine, index+1, len(plan.Jobs), job.Workload)
			}
			return nil
		})
		if err != nil {
			return err
		}
		if !received {
			return fmt.Errorf("worker exited without capturing %s", job.Workload)
		}
	}
	values, err := db.LocalValues(ctx, id)
	if err != nil {
		return err
	}
	for _, v := range values {
		if v.Status == "failed" {
			failed = true
		}
	}
	if err = db.SetLocalRunStatus(ctx, id, "completed", ""); err != nil {
		return err
	}
	if o.Baseline != "" {
		if err = localCompare(ctx, db, o.Baseline, id, o.JSON); err != nil {
			return err
		}
	}
	if !o.NoServe {
		url, err := ensureLocalPreview(ctx, o)
		if err != nil {
			return fmt.Errorf("results saved for %s, but preview could not start: %w; run wasmfyi serve -p 8789", id, err)
		}
		localPrint(o.JSON, map[string]any{"event": "completed", "id": id, "url": url + "/runs/" + id, "failed": failed}, "Saved locally. Results: %s/runs/%s\n", url, id)
	} else {
		localPrint(o.JSON, map[string]any{"event": "completed", "id": id, "failed": failed}, "Saved locally. Run: %s\n", id)
	}
	if failed {
		return fmt.Errorf("capture finished with workload failures; inspect wasmfyi runs %s\n%s", id, notes)
	}
	return nil
}

type localIdentity struct {
	PID     int    `json:"pid"`
	Start   string `json:"start"`
	Command string `json:"command"`
	Run     string `json:"run,omitempty"`
	URL     string `json:"url,omitempty"`
	Data    string `json:"data,omitempty"`
}

func processIdentity(pid int) (string, string) {
	start, _ := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "lstart=").Output()
	command, _ := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "command=").Output()
	return strings.TrimSpace(string(start)), strings.TrimSpace(string(command))
}
func newLocalIdentity(run string) localIdentity {
	start, command := processIdentity(os.Getpid())
	return localIdentity{PID: os.Getpid(), Start: start, Command: command, Run: run}
}
func readLocalIdentity(path string) (localIdentity, error) {
	var i localIdentity
	b, e := os.ReadFile(path)
	if e != nil {
		return i, e
	}
	e = json.Unmarshal(b, &i)
	return i, e
}
func localIdentityAlive(i localIdentity) bool {
	if i.PID <= 1 || i.Start == "" || i.Command == "" {
		return false
	}
	start, command := processIdentity(i.PID)
	return start == i.Start && command == i.Command
}
func stopLocalCapture(data, id string) error {
	if !localIdentifier(id) {
		return fmt.Errorf("invalid run ID")
	}
	i, err := readLocalIdentity(filepath.Join(data, "runtime", "capture.json"))
	if err != nil {
		return err
	}
	if i.Run != id || !localIdentityAlive(i) {
		return fmt.Errorf("run is not owned by a live local capture")
	}
	return syscall.Kill(i.PID, syscall.SIGTERM)
}
func localCompare(ctx context.Context, db *sqldb.Store, before, after string, jsonMode bool) error {
	ar, err := db.LocalRun(ctx, before)
	if err != nil {
		return err
	}
	br, err := db.LocalRun(ctx, after)
	if err != nil {
		return err
	}
	var ap, bp map[string]json.RawMessage
	_ = json.Unmarshal(ar.Plan, &ap)
	_ = json.Unmarshal(br.Plan, &bp)
	if string(ap["policy"]) != string(bp["policy"]) {
		return fmt.Errorf("runs use different collector builds; recapture the baseline with this CLI")
	}
	if string(ap["host"]) != string(bp["host"]) {
		return fmt.Errorf("runs have different host or power-state descriptions; compare captures from the same environment")
	}
	if string(ap["collection"]) != string(bp["collection"]) {
		return fmt.Errorf("runs use different sampling policies; capture both with matching options")
	}
	a, err := db.LocalValues(ctx, before)
	if err != nil {
		return err
	}
	b, err := db.LocalValues(ctx, after)
	if err != nil {
		return err
	}
	if len(a) == 0 || len(b) == 0 {
		return fmt.Errorf("comparison requires two runs with captured observations")
	}
	key := func(v sqldb.LocalValue) string {
		return strings.Join([]string{v.Platform, v.Engine, v.Workload, v.Artifact, v.Contract, v.Phase}, "\000")
	}
	index := map[string]sqldb.LocalValue{}
	for _, v := range a {
		index[key(v)] = v
	}
	type delta struct {
		Engine       string  `json:"engine"`
		Workload     string  `json:"workload"`
		Phase        string  `json:"phase"`
		Before       float64 `json:"beforeNs"`
		After        float64 `json:"afterNs"`
		Change       float64 `json:"changePercent"`
		BeforeStatus string  `json:"beforeStatus"`
		AfterStatus  string  `json:"afterStatus"`
	}
	rows := []delta{}
	for _, v := range b {
		old, ok := index[key(v)]
		if !ok {
			continue
		}
		if old.Status != "ok" || v.Status != "ok" {
			if old.Status != v.Status {
				rows = append(rows, delta{Engine: v.Engine, Workload: v.Workload, Phase: v.Phase, BeforeStatus: old.Status, AfterStatus: v.Status})
			}
			continue
		}
		if old.Latency == nil || v.Latency == nil || *old.Latency <= 0 {
			continue
		}
		rows = append(rows, delta{Engine: v.Engine, Workload: v.Workload, Phase: v.Phase, Before: *old.Latency, After: *v.Latency, Change: (*v.Latency / *old.Latency - 1) * 100, BeforeStatus: old.Status, AfterStatus: v.Status})
	}
	sort.Slice(rows, func(i, j int) bool {
		if (rows[i].BeforeStatus != rows[i].AfterStatus) != (rows[j].BeforeStatus != rows[j].AfterStatus) {
			return rows[i].BeforeStatus != rows[i].AfterStatus
		}
		return rows[i].Change > rows[j].Change
	})
	if jsonMode {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"before": before, "after": after, "items": rows})
	}
	fmt.Printf("\nComparison: %s → %s (matching engine, artifact and contract)\n", before, after)
	if len(rows) == 0 {
		fmt.Println("  No comparable measured contracts.")
	}
	for _, r := range rows {
		if r.BeforeStatus != r.AfterStatus {
			fmt.Printf("  %-20s %-40s %-12s %s → %s\n", r.Engine, r.Workload, r.Phase, r.BeforeStatus, r.AfterStatus)
		} else {
			fmt.Printf("  %-20s %-40s %-12s %+.1f%%  %s → %s\n", r.Engine, r.Workload, r.Phase, r.Change, localLatency(r.Before), localLatency(r.After))
		}
	}
	return nil
}
func localCache(o localOptions, args []string) error {
	if len(args) > 0 && args[0] == "prune" {
		if i, err := readLocalIdentity(filepath.Join(o.Data, "runtime", "capture.json")); err == nil && localIdentityAlive(i) {
			return fmt.Errorf("cannot prune while a capture owns this dataset")
		}
		// Only ephemeral, abandoned measurement scratch is universally unreferenced.
		path := filepath.Join(o.Cache, "scratch")
		entries, err := os.ReadDir(path)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		for _, entry := range entries {
			parts := strings.Split(entry.Name(), "-")
			pid, e := strconv.Atoi(parts[len(parts)-1])
			if e != nil {
				continue
			}
			start, _ := processIdentity(pid)
			if start != "" {
				continue
			}
			if err := os.RemoveAll(filepath.Join(path, entry.Name())); err != nil {
				return err
			}
		}
		fmt.Println("Removed abandoned scratch. Immutable source and resumable SDK caches retained.")
		return nil
	}
	var bytes int64
	var files int
	_ = filepath.WalkDir(o.Cache, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if i, e := d.Info(); e == nil {
				bytes += i.Size()
				files++
			}
		}
		return nil
	})
	localPrint(o.JSON, map[string]any{"path": o.Cache, "bytes": bytes, "files": files}, "Cache: %s\n  %.1f MiB · %d files\n", o.Cache, float64(bytes)/(1<<20), files)
	return nil
}

// Accept flags before or after positional run IDs, without changing flag values.
func localFlagOrder(fs *flag.FlagSet, args []string) []string {
	flags, positionals := []string{}, []string{}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			positionals = append(positionals, args[i+1:]...)
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			positionals = append(positionals, arg)
			continue
		}
		flags = append(flags, arg)
		name := strings.TrimLeft(arg, "-")
		if strings.Contains(name, "=") {
			continue
		}
		f := fs.Lookup(name)
		if f == nil {
			continue
		}
		b, ok := f.Value.(interface{ IsBoolFlag() bool })
		if ok && b.IsBoolFlag() {
			continue
		}
		if i+1 < len(args) {
			i++
			flags = append(flags, args[i])
		}
	}
	return append(flags, positionals...)
}

// The shared cache has a kernel lease across datasets; crashes release it.
func localCacheLease(cache string) (func(), error) {
	if err := os.MkdirAll(cache, 0700); err != nil {
		return nil, err
	}
	release, err := localNamedLease(filepath.Join(cache, ".cli-lock"))
	if err != nil {
		return nil, fmt.Errorf("another CLI run is using this cache; wait or use --cache for an independent cache: %w", err)
	}
	return release, nil
}
func localNamedLease(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, err
	}
	return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }, nil
}

// SDK builders can create their own process groups. Capture their descendants
// before signalling the worker so cancellation cannot orphan a compiler.
func terminateLocalTree(pid int) error {
	output, _ := exec.Command("ps", "-axo", "pid=,ppid=").Output()
	children := map[int][]int{}
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		p, e := strconv.Atoi(fields[0])
		parent, e2 := strconv.Atoi(fields[1])
		if e == nil && e2 == nil {
			children[parent] = append(children[parent], p)
		}
	}
	targets := []localIdentity{}
	var visit func(int)
	visit = func(parent int) {
		for _, child := range children[parent] {
			visit(child)
		}
		start, command := processIdentity(parent)
		targets = append(targets, localIdentity{PID: parent, Start: start, Command: command})
	}
	visit(pid)
	for _, i := range targets {
		_ = syscall.Kill(i.PID, syscall.SIGTERM)
	}
	go func() {
		time.Sleep(2 * time.Second)
		for _, i := range targets {
			if localIdentityAlive(i) {
				_ = syscall.Kill(i.PID, syscall.SIGKILL)
			}
		}
	}()
	return nil
}

func localLatency(ns float64) string {
	if ns >= 1e9 {
		return fmt.Sprintf("%.3g s", ns/1e9)
	}
	if ns >= 1e6 {
		return fmt.Sprintf("%.3g ms", ns/1e6)
	}
	if ns >= 1e3 {
		return fmt.Sprintf("%.3g µs", ns/1e3)
	}
	return fmt.Sprintf("%.3g ns", ns)
}
