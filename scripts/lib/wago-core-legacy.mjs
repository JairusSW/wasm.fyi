// Compatibility lives exclusively in the benchmark embedding, never the SDK.
import {readFile,writeFile,readdir,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
const cut=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<0)throw Error('Historical core boundary missing: '+start);return text.slice(0,a)+text.slice(b);};
export async function adaptCoreLegacyWago({root,base,api,run}) {
 const dir=join(root,'adapters/wago');
 const slots=api.includes('func (in *Instance) Invoke(export string, args ...uint64)'),config=api.includes('func CompileWithConfig('),sync=api.includes('type SyncHostFunc ');
 for(const file of await readdir(join(base,'adapters/wago')))if(file.endsWith('.go'))await cp(join(base,'adapters/wago',file),join(dir,file));
 await writeFile(join(dir,'wasi_readonly.go'),'package main\n// WASI is excluded from historical core captures.\n');
 await cp(join(base,'experiment/build.go'),join(root,'experiment/build.go'));
 const stub=name=>`package main\nimport "github.com/wasmbench/wasmbench/protocol"\ntype unsupportedRequest string\nfunc (e unsupportedRequest) Error() string {return string(e)}\nfunc (a *adapter) ${name}(r *protocol.RunRequest) ([]protocol.Sample,error) {return nil,unsupportedRequest("historical core adapter does not support this scenario")}\n`;
 await writeFile(join(dir,'plugin_features.go'),stub('runPluginFeature'));
 await writeFile(join(dir,'density.go'),stub('runDensity').replace('type unsupportedRequest string\nfunc (e unsupportedRequest) Error() string {return string(e)}\n',''));
 let main=await readFile(join(dir,'main.go'),'utf8');
 main=main.replace(/\n\s*(?:component "github.com\/wago-org\/component-model"|wagoplugin "github.com\/wago-org\/wago\/plugin"|"context")/g,'');
 main=cut(main,'\thostRuntime      *wago.Runtime','\n}');
 main=cut(main,'\tif a.componentCache != nil {','\ta.imports = nil');
 main=cut(main,'func (a *adapter) instantiate(', 'func (a *adapter) initialize(');
 main=main.replace('func (a *adapter) initialize(', 'func (a *adapter) instantiate(c *historicalCompiled) (*historicalInstance,error) { return historicalInstantiate(c,a.imports) }\nfunc (a *adapter) initialize(');
 main=cut(main,'\t\t\t\t\ta.hostRuntime = wago.NewRuntime()','\t\t\t\t} else if a.prep.Workload.HostProfile !=');
 main=main.replace('\t\t\t\t} else if a.prep.Workload.HostProfile !=','\t\t\t\t\ta.imports, e = historicalAbortImports()\n\t\t\t\t} else if a.prep.Workload.HostProfile !=');
 main=cut(main,'\t\t\t\tcase "wasi-command":','\t\t\t\tdefault:');
 main=main.replace('a.imports = identityImports()','a.imports, e = historicalIdentityImports()');
 main=main.replace(/func identityImports\(\) \*wago.Imports \{[\s\S]*?\n\}/,'');
 main=main.replace('wago.NewRuntimeConfig().WithMaxModuleBytes(uint64(len(a.wasm)))','historicalConfig()');
 main=main.replace('resp.Description.Scenarios = append(resp.Description.Scenarios, "app-init")',`resp.Description.Embedding = "Go API / historical core embedding"
                resp.Description.ABIs = []string{"core"}
                resp.Description.Features = []string{"mvp"}
                for _, key := range []string{"can_run_commands", "can_run_component_commands", "can_component_command_lifecycle", "can_component_u64_calls_v1"} { resp.Description.Capabilities[key] = false }
                resp.Description.Configuration = map[string]string{"source_revision":sourceRevision,"runtime_config":"pinned SDK defaults","module_cache":"disabled","host_callback_policy":"pinned SDK public callback API; unavailable signatures explicitly unsupported","invoke_policy":"signature lookup outside timing; pinned Instance.Invoke export dispatch inside timing"}
                resp.Description.Scenarios = append(resp.Description.Scenarios, "app-init")`);
 main=main.replace('\t\t\tcase "prepare":',`                resp.Description.ValidatorFeatures = nil
                resp.Description.Capabilities["can_density"] = false
                delete(resp.Description.Configuration,"density_policy")
                resp.Description.PhaseBarrierScenarios = []string{"compile","teardown","app-init","instantiate","first-call","steady"}
                ${api.includes('type TrapError ')?'':'resp.Description.Capabilities["can_verify_invocation_traps"] = false\n                resp.Description.Capabilities["can_measure_invocation_traps"] = false'}
            case "prepare":`);
 await writeFile(join(dir,'main.go'),main);
 let instantiate=await readFile(join(dir,'instantiate.go'),'utf8');
 instantiate=cut(instantiate,'\tinstantiate := func()', '\tout := make(');
 instantiate=instantiate.replace('\tout := make(', '\tinstantiate := func() (*historicalInstance,error) {return a.instantiate(a.compiled)}\n\tout := make(').replace('\n\t"context"','');
 await writeFile(join(dir,'instantiate.go'),instantiate);
 if(!api.includes('type TrapError '))await writeFile(join(dir,'traps.go'),stub('runTraps').replace('type unsupportedRequest string\nfunc (e unsupportedRequest) Error() string {return string(e)}\n',''));
 for(const file of await readdir(dir))if(file.endsWith('.go')&&!file.endsWith('_test.go')) {
  let text=await readFile(join(dir,file),'utf8');
  text=text.replaceAll('*wago.Compiled','*historicalCompiled').replaceAll('*wago.Instance','*historicalInstance').replaceAll('*wago.WasmFunc','*historicalFunction').replaceAll('*wago.RuntimeConfig','*historicalRuntimeConfig').replaceAll('*wago.Imports','historicalImports').replaceAll('wago.Compile(','historicalCompile(').replaceAll('wago.LoadTrustedArtifact(','historicalLoad(').replaceAll('.UnsafeBytes()', '.Bytes()').replaceAll('a.compiled.CodeSize()', 'len(a.compiled.Code)').replaceAll('a.compiled.WriteCodeTo(&image)','image.Write(a.compiled.Code)').replaceAll('wago.ValF32','0x7d').replaceAll('wago.ValF64','0x7c');
  if(file!=='traps.go'||!api.includes('type TrapError '))text=text.replace(/\n\s*wago "github.com\/wago-org\/wago"/g,'');
  await writeFile(join(dir,file),text);
 }
 const bridge=`package main
import ("fmt"; "math"; wago "github.com/wago-org/wago"${sync?'; "github.com/wasmbench/wasmbench/protocol"':''})
${config?'type historicalRuntimeConfig = wago.RuntimeConfig\nfunc historicalConfig() *historicalRuntimeConfig {return wago.NewRuntimeConfig()}':'type historicalRuntimeConfig struct{}\nfunc historicalConfig() *historicalRuntimeConfig {return &historicalRuntimeConfig{}}'}
type historicalCompiled struct{*wago.Compiled}
${slots?'':`func (c *historicalCompiled) Signature(name string)([]byte,[]byte,error){p,r,e:=c.Compiled.Signature(name);if e!=nil{return nil,nil,e};params:=make([]byte,len(p));results:=make([]byte,len(r));for i,v:=range p{switch v{case wago.I32(0).Type:params[i]=0x7f;case wago.I64(0).Type:params[i]=0x7e;case wago.F32(0).Type:params[i]=0x7d;case wago.F64(0).Type:params[i]=0x7c;default:return nil,nil,unsupportedRequest("historical signature parameter type unavailable")}};for i,v:=range r{switch v{case wago.I32(0).Type:results[i]=0x7f;case wago.I64(0).Type:results[i]=0x7e;case wago.F32(0).Type:results[i]=0x7d;case wago.F64(0).Type:results[i]=0x7c;default:return nil,nil,unsupportedRequest("historical signature result type unavailable")}};return params,results,nil}`}
func historicalCompile(cfg *historicalRuntimeConfig,b []byte)(*historicalCompiled,error) {c,e:=${config?'wago.CompileWithConfig(cfg,b)':'wago.Compile(b)'};if e!=nil{return nil,e};return &historicalCompiled{c},nil}
func historicalLoad(b []byte)(*historicalCompiled,error){c,e:=wago.Load(b);if e!=nil{return nil,e};return &historicalCompiled{c},nil}
${api.includes('func (c *Compiled) Close()')?'':'func (c *historicalCompiled) Close() error {return nil}'}
${sync?'type historicalImports = wago.Imports':'type historicalImports = map[string]wago.HostFunc'}
func historicalIdentityImports()(historicalImports,error){${sync?'return wago.Imports{"wasmbench.identity":wago.SyncHostFunc(func(_ wago.HostModule,p,r []uint64){r[0]=p[0]})},nil':'return nil,unsupportedRequest("pinned SDK only supports void i32 host callbacks; identity return signature unavailable")'}}
func historicalAbortImports()(historicalImports,error){${sync?'return wago.Imports{"env.abort":wago.SyncHostFunc(func(_ wago.HostModule,p,r []uint64){panic(protocol.AssemblyScriptAbort(uint32(p[0]),uint32(p[1]),uint32(p[2]),uint32(p[3])))})},nil':'return nil,unsupportedRequest("pinned SDK only supports void i32 host callbacks; AssemblyScript abort signature unavailable")'}}
type historicalInstance struct{*wago.Instance;c *historicalCompiled}
func (in *historicalInstance) nativeCodeInstance() any {return in.Instance}
func historicalInstantiate(c *historicalCompiled,imports historicalImports)(*historicalInstance,error){m,e:=wago.Instantiate(c.Compiled,imports);if e!=nil{return nil,e};return &historicalInstance{m,c},nil}
type historicalFunction struct{m *historicalInstance;name string;params []byte}
func (m *historicalInstance) WasmFunc(name string)(*historicalFunction,error){p,_,e:=m.c.Signature(name);if e!=nil{return nil,e};types:=make([]byte,len(p));for i,v:=range p{types[i]=byte(v)};return &historicalFunction{m,name,types},nil}
func (f *historicalFunction) Invoke(args ...uint64)([]uint64,error){${slots?'return f.m.Instance.Invoke(f.name,args...)':`if len(args)!=len(f.params){return nil,fmt.Errorf("argument count mismatch")};values:=make([]wago.Value,len(args));for i,b:=range args{switch f.params[i]{case 0x7f:values[i]=wago.I32(int32(b));case 0x7e:values[i]=wago.I64(int64(b));case 0x7d:values[i]=wago.F32(math.Float32frombits(uint32(b)));case 0x7c:values[i]=wago.F64(math.Float64frombits(b));default:return nil,unsupportedRequest("historical value API cannot represent parameter type")}};v,e:=f.m.Instance.Invoke(f.name,values...);if e!=nil{return nil,e};out:=make([]uint64,len(v));for i,x:=range v{out[i]=x.Bits};return out,nil`}}
${slots?'':`type historicalMemory []byte
func (b historicalMemory) Bytes() []byte{return b}
func (m *historicalInstance) Memory() historicalMemory{return historicalMemory(m.LinearMemory())}
func (m *historicalInstance) Read(offset,length uint32)([]byte,bool){b:=m.LinearMemory();end:=uint64(offset)+uint64(length);if end>uint64(len(b)){return nil,false};return b[offset:end],true}
func (m *historicalInstance) Write(offset uint32,b []byte) bool {mem:=m.LinearMemory();end:=uint64(offset)+uint64(len(b));if end>uint64(len(mem)){return false};copy(mem[offset:end],b);return true}`}
`;
 await writeFile(join(dir,'historical_core.go'),slots?bridge.replace('"fmt"; "math"; ',''):bridge);
 await run('gofmt',['-w',dir]);
 const files={};for(const file of (await readdir(dir)).sort())if(file.endsWith('.go')&&!file.endsWith('_test.go'))files[file]=digest(await readFile(join(dir,file)));
 return {api:slots?'uint64 slot Invoke':'typed Value Invoke',scope:'core only; no WASI dependencies',sdkModified:false,patchSha256:digest(JSON.stringify(files)),files};
}
