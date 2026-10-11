const inspect = `      case "inspect":{
        require(redline&&preparation!=null&&preparation.getString("profile").equals("code")&&preparation.getJSONObject("workload").getString("abi").equals("core"),"unsupported: code inspection requires prepared Redline core module");
        JSONObject execution=handle(new JSONObject(request.toString()).put("method","run").put("run",new JSONObject().put("scenario","compile").put("samples",1).put("operations",1).put("warmup",0)));
        JSONArray samples=execution.getJSONArray("samples");
        require(samples.length()==1&&samples.getJSONObject(0).getBoolean("verified"),"code inspection oracle was not verified");
        return new JSONObject().put("diagnostics",samples.getJSONObject(0).getJSONArray("observations"));
      }
`;
const capabilities='description.getJSONObject("capabilities").put("can_measure_native_code_size",true).put("can_code_profile",true);';
export function withEndiveCodeInspection(source){
 if(source.includes(inspect)){
  if(source.split(inspect).length!==2||source.split(capabilities).length!==2)throw Error('Endive code inspection seam changed');
  return source;
 }
 const run='      case "run":{',redline='if(redline){description.put("runtime","endive-redline")';
 if(source.split(run).length!==2||source.split(redline).length!==2||source.includes('case "inspect"')||source.includes(capabilities))throw Error('Endive code inspection requires exact qualified adapter seams');
 return source.replace(run,inspect+run).replace(redline,'if(redline){'+capabilities+'description.put("runtime","endive-redline")');
}
