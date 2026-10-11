package main

import (
 "strings"
 "testing"
 "github.com/wasmbench/wasmbench/protocol"
)

func TestCodeInspectionRejectsUnpreparedAndWrongProfile(t *testing.T) {
 for _, prepared := range []*protocol.Preparation{nil, {Profile:"timing"}, {Profile:"code"}} {
  a:=adapter{prep:prepared}
  response,err:=a.handle(protocol.Request{Version:1,ID:1,Method:"inspect"})
  if err==nil || !strings.Contains(err.Error(),"code inspection requires prepared core module") || len(response.Samples)!=0 {
   t.Fatalf("unsupported inspection reached execution: response=%+v error=%v",response,err)
  }
 }
}
