// Linux supports CPU affinity; macOS exposes foreground scheduling instead.
export function measurementLaunch(controller,args,{platform=process.platform,cpu=2}={}){
 if(platform==='linux')return {program:'taskset',args:['-c',String(cpu),controller,...args]};
 if(platform==='darwin')return {program:'taskpolicy',args:['-a','-t','0','-l','0',controller,...args]};
 return {program:controller,args:[...args]};
}
