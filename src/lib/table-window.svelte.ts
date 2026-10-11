/** Keep only nearby rows mounted, preserving measured row heights for scrolling. */
export function tableRange(heights: readonly number[], offset: number, viewport: number, overscan = 4) {
 const ends=[0];for(const height of heights)ends.push(ends.at(-1)!+height);
 let first=0;while(first<heights.length&&ends[first+1]<=offset)first++;
 let last=first;while(last<heights.length&&ends[last]<offset+viewport)last++;
 const start=Math.max(0,first-overscan),end=Math.min(heights.length,Math.max(first+1,last)+overscan);
 return {start,end,top:ends[start],bottom:ends.at(-1)!-ends[end]};
}
export class TableWindow {
 range=$state.raw({start:0,end:24,top:0,bottom:0});
 private keys:string[]=[];
 private heights=new Map<string,number>();
 private node:HTMLElement|undefined;
 private frame=0;
 private schedule=()=>{
  if(!this.node||this.frame)return;
  this.frame=requestAnimationFrame(()=>{this.frame=0;this.update()});
 };
 setRows(keys:string[]){
  this.keys=keys;
  const retained=new Set(keys);for(const key of this.heights.keys())if(!retained.has(key))this.heights.delete(key);
  this.update();
 }
 private update(){
  const rect=this.node?.getBoundingClientRect();
  // Desktop uses the table's scrollport; mobile allows the page to scroll.
  const offset=this.node?(this.node.scrollTop+Math.max(0,-rect!.top)):0;
  const viewport=rect?Math.max(0,Math.min(rect.bottom,window.innerHeight)-Math.max(0,rect.top)):600;
  const next=tableRange(this.keys.map(key=>this.heights.get(key)??36),offset,viewport);
  const prev=this.range;
  if(next.start!==prev.start||next.end!==prev.end||next.top!==prev.top||next.bottom!==prev.bottom)this.range=next;
 }
 observe=(node:HTMLElement)=>{
  this.node=node;
  const observer=new ResizeObserver(this.schedule);observer.observe(node);
  window.addEventListener('scroll',this.schedule,{passive:true,capture:true});
  window.addEventListener('resize',this.schedule,{passive:true});this.schedule();
  return {destroy:()=>{observer.disconnect();window.removeEventListener('scroll',this.schedule,true);window.removeEventListener('resize',this.schedule);cancelAnimationFrame(this.frame);this.frame=0;this.node=undefined}};
 };
 measure=(node:HTMLElement,key:string)=>{
  const observer=new ResizeObserver(entries=>{
   const height=entries[0]?.borderBoxSize?.[0]?.blockSize??node.getBoundingClientRect().height;
   if(height>0&&this.heights.get(key)!==height){this.heights.set(key,height);this.schedule()}
  });observer.observe(node);
  return {update:(next:string)=>{key=next},destroy:()=>observer.disconnect()};
 };
}
