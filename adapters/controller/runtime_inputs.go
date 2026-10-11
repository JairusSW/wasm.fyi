package experiment

import (
 "fmt"
 "io/fs"
 "os"
 "os/exec"
 "path/filepath"
 "strings"
)

// JVM flags and entrypoint class names are command policy, not file paths.
// Pin the actual classpath/module-path/JAR inputs before sealing the runtime.
func trackSDKJVMInputs(r *Runtime) error {
 // ELF $ORIGIN is relative to the real launcher, not an alternatives symlink.
 // Resolve before dependency probing and before sealing the executable hash.
 binary,err:=exec.LookPath(r.Command[0]);if err!=nil{return err}
 binary,err=filepath.EvalSymlinks(binary);if err!=nil{return err}
 r.Command[0]=binary
 var inputs []string
 for i:=1;i<len(r.Command);i++ {
  arg:=r.Command[i]
  switch arg {
  case "-jar":
   if i+1>=len(r.Command){return fmt.Errorf("JVM JAR input missing")};i++;inputs=append(inputs,r.Command[i])
  case "-cp","-classpath","--class-path","-p","--module-path","--upgrade-module-path":
   if i+1>=len(r.Command){return fmt.Errorf("JVM path input missing")};i++;inputs=append(inputs,strings.Split(r.Command[i],string(os.PathListSeparator))...)
  default:
   for _,prefix:=range []string{"--class-path=","--module-path=","--upgrade-module-path="} {
    if value,ok:=strings.CutPrefix(arg,prefix);ok{inputs=append(inputs,strings.Split(value,string(os.PathListSeparator))...);break}
   }
  }
 }
 if len(inputs)==0{return fmt.Errorf("SDK JVM command declares no artifact inputs")}
 observed:=0
 for _,input:=range inputs {
  if input==""{return fmt.Errorf("SDK JVM path must be explicit")}
  var paths []string
  if strings.HasSuffix(input,"*") {
   // Java expands a classpath wildcard only to JAR files in that directory.
   entries,err:=os.ReadDir(strings.TrimSuffix(input,"*"));if err!=nil{return err}
   for _,entry:=range entries{if !entry.IsDir()&&strings.EqualFold(filepath.Ext(entry.Name()),".jar"){paths=append(paths,filepath.Join(strings.TrimSuffix(input,"*"),entry.Name()))}}
  } else {paths=[]string{input}}
  for _,path:=range paths {
   err:=filepath.WalkDir(path,func(path string,entry fs.DirEntry,err error)error{
    if err!=nil{return err};if entry.IsDir(){return nil}
    hash,err:=DigestFile(path);if err!=nil{return err};r.Files[path]=hash;observed++;return nil
   });if err!=nil{return fmt.Errorf("SDK JVM input %s: %w",path,err)}
  }
 }
 if observed==0{return fmt.Errorf("SDK JVM classpath contains no artifacts")}
 return nil
}
