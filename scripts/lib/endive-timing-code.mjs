export function withEndiveTimingCodeSize(source){
 const before='            if(preparation.getString("profile").equals("code")){\n              require(scenario.equals("compile")&&samples==1&&warmup==0,"unsupported: code size requires one compile pass");';
 const after='            if(preparation.getString("profile").equals("code"))require(scenario.equals("compile")&&samples==1&&warmup==0,"unsupported: code size requires one compile pass");\n            if(preparation.getString("profile").equals("code")||(redline&&scenario.equals("compile")&&index==0&&warmup==0&&preparation.getString("profile").equals("timing"))){';
 const observedProfile='.put("profile",preparation.getString("profile")).put("quality","engine_reported")';
 if(source.includes(after)){
  if(source.split(after).length!==2||source.split(observedProfile).length!==2)throw Error('Endive native-code observation profile changed');
  return source;
 }
 if(source.split(before).length!==2)throw Error('Endive native-code observation block changed');
 const profile='.put("profile","code").put("quality","engine_reported")';
 if(source.split(profile).length!==2)throw Error('Endive native-code observation profile changed');
 return source.replace(before,after).replace(profile,observedProfile);
}
