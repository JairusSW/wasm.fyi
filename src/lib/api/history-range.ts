export function timelineRange(from:number,to:number,length:number,changedWindow:boolean){
 const last=Math.max(0,length-1);
 return changedWindow?{from:0,to:last}:{from:Math.min(from,last),to:Math.min(to,last)};
}
