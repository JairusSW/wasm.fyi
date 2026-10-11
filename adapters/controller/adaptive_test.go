package experiment

import (
 "testing"
 "github.com/wasmbench/wasmbench/protocol"
)

func TestAdaptiveSamplesPersistentGroupsAndOrder(t *testing.T){
 calls:=0
 response,err:=collectAdaptiveSamples(func(r protocol.RunRequest)(protocol.Response,error){
  calls++;if r.Samples!=5||r.Warmup!=0{t.Fatal(r)}
  out:=protocol.Response{Status:"ok"}
  for i:=0;i<5;i++{value:=int64(100);if calls==1{value=int64(300-i*30)};out.Samples=append(out.Samples,protocol.Sample{Index:i,ElapsedNS:value,Operations:1,Verified:true,SampleType:"individual_operation"})}
  return out,nil
 },protocol.RunRequest{Scenario:"steady",Operations:1})
 if err!=nil||calls!=3||len(response.Samples)!=15{t.Fatal(calls,len(response.Samples),err)}
 for i,s:=range response.Samples{if s.Index!=i{t.Fatal("lost acquisition order")}}
}

func TestAdaptiveSamplesCapsNoiseAndRejectsInvalidGroups(t *testing.T){
 calls:=0
 response,err:=collectAdaptiveSamples(func(r protocol.RunRequest)(protocol.Response,error){calls++;out:=protocol.Response{Status:"ok"};for i:=0;i<5;i++{out.Samples=append(out.Samples,protocol.Sample{Index:i,ElapsedNS:int64(100+i%2*100),Operations:1,Verified:true,SampleType:"individual_operation"})};return out,nil},protocol.RunRequest{Scenario:"steady",Operations:1})
 if err!=nil||calls!=5||len(response.Samples)!=25{t.Fatal(calls,err)}
 _,err=collectAdaptiveSamples(func(r protocol.RunRequest)(protocol.Response,error){return protocol.Response{Status:"ok",Samples:[]protocol.Sample{{}}},nil},protocol.RunRequest{Scenario:"steady",Operations:1})
 if err==nil{t.Fatal("invalid sample group accepted")}
}

func TestAdaptivePhaseCaps(t *testing.T){
 for _,phase:=range []string{"compile","instantiate","first-call","steady"}{
  t.Run(phase,func(t *testing.T){
   count:=0
   out,err:=collectAdaptiveSamples(func(r protocol.RunRequest)(protocol.Response,error){
    count++;if r.Samples!=5||r.Warmup!=0{t.Fatal(r)}
    response:=protocol.Response{Status:"ok"}
    for i:=0;i<5;i++{response.Samples=append(response.Samples,protocol.Sample{Index:i,ElapsedNS:int64(100+i%2*100),Operations:1,Verified:true,SampleType:"individual_operation"})}
    return response,nil
   },protocol.RunRequest{Scenario:phase,Operations:1})
   want:=25;if phase=="compile"||phase=="instantiate"{want=10}
   if err!=nil||len(out.Samples)!=want||count!=want/5{t.Fatal(count,len(out.Samples),err)}
  })
 }
}
