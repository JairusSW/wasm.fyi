/** Observe the scroll boundary without forcing layout on every scroll event. */
export function observeSticky(sentinel:HTMLElement,set:(stuck:boolean)=>void) {
 const wide=matchMedia('(min-width: 721px)');
 let above=false;
 const update=()=>set(wide.matches&&above);
 const observer=new IntersectionObserver(entries=>{
  const entry=entries.find(entry=>entry.target===sentinel);if(!entry)return;
  above=entry.boundingClientRect.top<0;update();
 });
 observer.observe(sentinel);wide.addEventListener('change',update);update();
 return ()=>{observer.disconnect();wide.removeEventListener('change',update)};
}
