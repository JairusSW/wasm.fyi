package experiment

import (
 "os"
 "path/filepath"
 "testing"
)
func TestSDKJVMPolicyAndArtifactFiles(t *testing.T) {
 root:=t.TempDir();classes:=filepath.Join(root,"classes");libs:=filepath.Join(root,"libs")
 for _,path:=range []string{classes,libs}{if err:=os.Mkdir(path,0700);err!=nil{t.Fatal(err)}}
 binary:=filepath.Join(root,"java-real");launcher:=filepath.Join(root,"java")
 if err:=os.WriteFile(binary,[]byte("test launcher"),0700);err!=nil{t.Fatal(err)}
 if err:=os.Symlink(binary,launcher);err!=nil{t.Fatal(err)}
 class:=filepath.Join(classes,"Adapter.class");jar:=filepath.Join(libs,"runtime.jar")
 for _,path:=range []string{class,jar}{if err:=os.WriteFile(path,[]byte("qualified SDK"),0600);err!=nil{t.Fatal(err)}}
 if err:=os.WriteFile(filepath.Join(libs,"README"),[]byte("not a JVM input"),0600);err!=nil{t.Fatal(err)}
 r:=Runtime{Command:[]string{launcher,"-XX:ActiveProcessorCount=1","-Xbatch","-cp",classes+string(os.PathListSeparator)+filepath.Join(libs,"*"),"Adapter","--interpreter"},Files:map[string]string{}}
 if err:=trackSDKJVMInputs(&r);err!=nil{t.Fatal(err)}
 if r.Command[0]!=binary{t.Fatalf("launcher symlink was not resolved: %s",r.Command[0])}
 if len(r.Files)!=2||r.Files[class]==""||r.Files[jar]==""{t.Fatalf("wrong pinned input set: %v",r.Files)}
 old:=r.Files[jar];if err:=os.WriteFile(jar,[]byte("changed SDK"),0600);err!=nil{t.Fatal(err)}
 if err:=trackSDKJVMInputs(&r);err!=nil{t.Fatal(err)};if old==r.Files[jar]{t.Fatal("SDK content change was not reflected")}
}
func TestSDKJVMMissingArtifactFailsClosed(t *testing.T) {
 for _,command:=range [][]string{{"java","-jar"},{"java","-Xbatch","Adapter"},{"java","-jar",filepath.Join(t.TempDir(),"missing.jar")}} {
  r:=Runtime{Command:command,Files:map[string]string{}};if err:=trackSDKJVMInputs(&r);err==nil{t.Fatalf("accepted missing inputs: %v",command)}
 }
}
