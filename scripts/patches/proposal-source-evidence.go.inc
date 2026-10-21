type proposalSourceEvidence struct {
	Feature        string `json:"feature"`
	Compiler       string `json:"compiler"`
	Validator      string `json:"validator"`
	Entry          string `json:"entry"`
	Policy         string `json:"policy"`
	SourceRevision string `json:"source_revision"`
	SourcePath     string `json:"source_path"`
	SourceSHA256   string `json:"source_sha256"`
}

func (p *proposalSourceEvidence) validate(feature string) error {
	if p.Feature != feature || !slices.Contains([]string{"half-precision", "stringref", "acquire-release-atomics", "custom-descriptors"}, feature) || p.Compiler != "V8 wasm-module-builder@34f4bf16f621ceba505ef2b7b818d48d09a5d3d3" || p.Validator != "V8 15.2.20" || p.Entry != "WebAssembly.Module" || p.Policy != "Pinned proposal dialect; wasm-tools does not implement these encodings" || p.SourceRevision != "34f4bf16f621ceba505ef2b7b818d48d09a5d3d3" || p.SourcePath != "test/mjsunit/wasm/wasm-module-builder.js" || p.SourceSHA256 != "2d04976cccbf1b11de25438fd411a355f3444529dc32cc04f2873df2ce9aaf4b" {
		return fmt.Errorf("invalid proposal source evidence")
	}
	return nil
}

func sourceValidatedProposalEvidence(w protocol.Workload, analyzer *AnalyzerLock) (json.RawMessage, bool) {
	var provenance struct {
		Feature string `json:"feature"`
		Recipe  struct {
			SHA256   string `json:"sha256"`
			Compiler string `json:"compiler"`
			Validator struct {
				Engine string `json:"engine"`
				Entry  string `json:"entry"`
				Policy string `json:"policy"`
			} `json:"validator"`
		} `json:"recipe"`
		Sources []struct {
			Revision string `json:"revision"`
			Path     string `json:"path"`
			SHA256   string `json:"sha256"`
		} `json:"sources"`
	}
	if json.Unmarshal(w.Provenance, &provenance) != nil || provenance.Feature == "" || provenance.Recipe.SHA256 != w.SHA256 || len(provenance.Sources) != 1 {
		return nil, false
	}
	p := proposalSourceEvidence{Feature: provenance.Feature, Compiler: provenance.Recipe.Compiler, Validator: provenance.Recipe.Validator.Engine, Entry: provenance.Recipe.Validator.Entry, Policy: provenance.Recipe.Validator.Policy, SourceRevision: provenance.Sources[0].Revision, SourcePath: provenance.Sources[0].Path, SourceSHA256: provenance.Sources[0].SHA256}
	if p.validate(provenance.Feature) != nil {
		return nil, false
	}
	evidence, err := json.Marshal(map[string]any{"schema": 2, "analyzer": "source-bound-v8", "analyzer_version": "15.2.20", "analysis_version": "proposal-source-v1", "encoding": "core-module", "validation_profile": analyzer.Profile, "validation_features": []string{provenance.Feature}, "validated": true, "sha256": w.SHA256, "proposal_source": p})
	return evidence, err == nil
}

