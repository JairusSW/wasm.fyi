import org.graalvm.polyglot.Engine;
import org.json.JSONArray;
import org.json.JSONObject;

// Build-time discovery only. Benchmark processes use a preselected constant list.
public final class GraalWasmOptions {
  public static void main(String[] args) {
    JSONArray names=new JSONArray(),engineNames=new JSONArray();
    try(Engine engine=Engine.newBuilder().allowExperimentalOptions(true).build()) {
      for(var option:engine.getLanguages().get("wasm").getOptions())names.put(option.getName());
      for(var option:engine.getOptions())engineNames.put(option.getName());
    }
    System.out.println(new JSONObject().put("wasmOptions",names).put("engineOptions",engineNames));
  }
}
