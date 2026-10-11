package benchdb

import "testing"

func TestFeatureCompatibilitySampling(t *testing.T) {
	makeCapture := func() Capture {
		c := fixture("2026-10-10T00:00:00Z", 10)
		r := &c.Results[0]
		r.Workload = "features/core-num/integer-multiply-add/1"
		r.TimingSamples = 1
		r.SamplesNs = []float64{10}
		r.Sampling = &Sampling{Method: "feature-compatibility-v1", GroupSize: 1, MaxSamples: 1, StopReason: "fixed-sample"}
		return c
	}
	if err := Validate(makeCapture()); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*Row){
		"application workload": func(r *Row) { r.Workload = "applications/test" },
		"extra observations":   func(r *Row) { r.TimingSamples = 2; r.SamplesNs = []float64{10, 10} },
		"warmup":               func(r *Row) { r.Sampling.Warmup = 1 },
		"trimmed observation":  func(r *Row) { r.Sampling.RetainedStart = 1 },
		"adaptive policy":      func(r *Row) { r.Sampling.StopReason = "stable" },
		"unknown policy":       func(r *Row) { r.Sampling.Method = "other" },
	} {
		t.Run(name, func(t *testing.T) {
			c := makeCapture()
			change(&c.Results[0])
			if Validate(c) == nil {
				t.Fatal("accepted invalid compatibility capture")
			}
		})
	}
}
