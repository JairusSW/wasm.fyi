package wire

import "testing"

func TestMetricBindingDoesNotPermitLabelsToReplaceDefinitions(t *testing.T) {
	r := Result{Metric: "time.wall", MetricDefinitionStatus: "available"}
	d := []byte(`{"name":"time.wall","version":1,"unit":"ns","scope":"embedding_api"}`)
	if e := ValidateMetricBinding(r, d); e != nil {
		t.Fatal(e)
	}
	for _, bad := range []string{`{"name":"process.rss","version":1,"unit":"bytes","scope":"adapter_process"}`, `{"name":"time.wall","version":0,"unit":"ns","scope":"embedding_api"}`, `{"name":"time.wall","status":"unregistered","reason":"fixture"}`} {
		if e := ValidateMetricBinding(r, []byte(bad)); e == nil {
			t.Fatal("wrong definition accepted")
		}
	}
	r = Result{Metric: "native.code_size", MetricDefinitionStatus: "unregistered"}
	if e := ValidateMetricBinding(r, []byte(`{"name":"native.code_size","status":"unregistered","reason":"source registry omission"}`)); e != nil {
		t.Fatal(e)
	}
}

func TestRetainedProcessTreeMetricPreservesRegistryOmission(t *testing.T) {
	r := Result{Metric: "process_tree.rss.mean", MetricDefinitionStatus: "unregistered"}
	marker := []byte(`{"name":"process_tree.rss.mean","status":"unregistered","reason":"source registry omission"}`)
	if err := ValidateMetricBinding(r, marker); err != nil {
		t.Fatal(err)
	}
	r.MetricDefinitionStatus = "available"
	if ValidateMetricBinding(r, marker) == nil {
		t.Fatal("omission promoted to registered definition")
	}
}
