package experiment

import (
 "fmt"
 "math"
 "sort"
 "github.com/wasmbench/wasmbench/protocol"
)

func validateSteadyOperations(operations int) error {
 if operations < 0 || operations > 1000000 {
  return fmt.Errorf("steady operations must be within 0..1000000")
 }
 return nil
}

// The samples share a process. This is a repeatability stopping rule and
// deliberately makes no independent-launch confidence claim.
func adaptiveStable(samples []protocol.Sample) bool {
 n:=len(samples);if n<5||n%5!=0{return false}
 start:=0;if n>10{start=n-10}
 values:=make([]float64,n-start)
 mean:=0.0
 for i,s:=range samples[start:]{values[i]=adaptiveSampleValue(s);mean+=values[i]}
 mean/=float64(len(values))
 variance:=0.0;for _,v:=range values{variance+=(v-mean)*(v-mean)}
 sd:=math.Sqrt(variance/float64(len(values)-1))
 if mean==0{return sd==0}
 middle:=len(values)/2
 median:=func(v []float64)float64{copyValues:=append([]float64(nil),v...);sort.Float64s(copyValues);i:=len(copyValues)/2;if len(copyValues)%2==1{return copyValues[i]};return (copyValues[i-1]+copyValues[i])/2}
 drift:=math.Abs(median(values[:middle])-median(values[middle:]))/mean
 return sd/mean<=0.05&&drift<=0.03
}

func collectAdaptiveSamples(call func(protocol.RunRequest)(protocol.Response,error),request protocol.RunRequest)(protocol.Response,error){
 request.Samples=5;request.Warmup=0
 var output protocol.Response
 maxSamples:=25
 if request.Scenario=="compile"||request.Scenario=="instantiate"{maxSamples=10}
 for group:=0;group<maxSamples/5;group++{
  response,err:=call(request)
  if err!=nil{return response,err}
  if response.Status!="ok"{return response,fmt.Errorf("adaptive group status %s",response.Status)}
  if err:=validateSampleSequence(request,response.Samples);err!=nil{return response,err}
  for _,s:=range response.Samples{if !s.Verified||s.ElapsedNS<0||s.Operations<1{return response,fmt.Errorf("adaptive group contains an unverified or invalid sample")}}
  if group==0{output=response;output.Samples=nil}
  for _,s:=range response.Samples{s.Index=len(output.Samples);output.Samples=append(output.Samples,s)}
  if adaptiveStable(output.Samples){break}
 }
 return output,nil
}

// Use the complete C-AOT pipeline for the stopping rule, matching publication.
// Preserve the original timer and stage observations in the recorded samples.
func adaptiveSampleValue(sample protocol.Sample) float64 {
	stages := map[string]float64{}
	for _, observation := range sample.Observations {
		if observation.Status == "available" && observation.Value != nil && *observation.Value >= 0 && !math.IsInf(*observation.Value, 0) && !math.IsNaN(*observation.Value) {
			stages[observation.Metric] += *observation.Value
		}
	}
	translation, hasTranslation := stages["aot.translation.elapsed"]
	if !hasTranslation {
		translation, hasTranslation = stages["aot.transpile.elapsed"]
	}
	compiled, hasCompiled := stages["aot.native_compile.elapsed"]
	if !hasCompiled {
		compiled, hasCompiled = stages["aot.pipeline.elapsed"]
	}
	if hasTranslation && hasCompiled {
		return (translation + compiled) / float64(sample.Operations)
	}
	return float64(sample.ElapsedNS) / float64(sample.Operations)
}
