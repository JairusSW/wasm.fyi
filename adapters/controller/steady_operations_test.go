package experiment

import (
 "testing"
 "github.com/wasmbench/wasmbench/protocol"
)

func TestSteadyOperationsOnlyChangesMeasuredSteady(t *testing.T) {
 options:=Options{Profile:"timing",Samples:5,Operations:1,SteadyOperations:1000000,Warmup:0}
 for _,phase:=range []string{"compile","instantiate","first-call","steady"} {
  request:=trialRequest(options,protocol.Workload{},phase,0)
  want:=1;if phase=="steady"{want=1000000}
  if request.Operations!=want{t.Fatalf("%s operations=%d, want %d",phase,request.Operations,want)}
  if request.Warmup!=0||request.Samples!=5{t.Fatalf("%s changed samples or warmup: %+v",phase,request)}
 }
 admission:=trialRequest(options,protocol.Workload{},"steady",-1)
 if admission.Scenario!="first-call"||admission.Operations!=1{t.Fatalf("admission was batched: %+v",admission)}
 options.SteadyOperations=0
 if request:=trialRequest(options,protocol.Workload{},"steady",0);request.Operations!=1{t.Fatalf("default operations changed: %+v",request)}
}

func TestSteadyOperationsBounds(t *testing.T) {
 for _,operations:=range []int{0,1,1000000} {
  if err:=validateSteadyOperations(operations);err!=nil{t.Fatalf("valid %d: %v",operations,err)}
 }
 for _,operations:=range []int{-1,1000001} {
  if err:=validateSteadyOperations(operations);err==nil{t.Fatalf("accepted %d",operations)}
 }
}
