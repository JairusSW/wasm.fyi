<script lang="ts">
 import {localDate,selectableDate} from '$lib/api/calendar-date';
 let {value=$bindable(''),label,min='',max='',dates}:{value?:string;label:string;min?:string;max?:string;dates?:string[]}=$props();
 const today=localDate();
 let open=$state(false);
 let root:HTMLDivElement;
 const initial=value?new Date(value+'T12:00:00'):new Date();
 let year=$state(initial.getFullYear()),month=$state(initial.getMonth());
 const monthName=$derived(new Intl.DateTimeFormat('en',{month:'long',year:'numeric'}).format(new Date(year,month,1)));
 const days=$derived(Array.from({length:new Date(year,month+1,0).getDate()},(_,i)=>i+1));
 const blanks=$derived(Array.from({length:(new Date(year,month,1).getDay()+6)%7}));
 const key=(day:number)=>`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 const allowed=(date:string)=>selectableDate(date,today,min,max,dates);
 function move(delta:number){const d=new Date(year,month+delta,1);year=d.getFullYear();month=d.getMonth()}
 function toggle(){if(!open&&value){const d=new Date(value+'T12:00:00');year=d.getFullYear();month=d.getMonth()}open=!open;if(open)queueMicrotask(()=>root.querySelector<HTMLButtonElement>('.grid button[aria-pressed="true"], .grid button:not(:disabled)')?.focus())}
 function close(){open=false;root.querySelector<HTMLButtonElement>('.trigger')?.focus()}
 function select(day:number){value=key(day);close()}
 function keyboard(event:KeyboardEvent){
  if(event.key==='Escape'){event.preventDefault();close();return}
  const target=event.target as HTMLElement,date=target.dataset.date;
  if(!date)return;
  const shifts:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
  if(!(event.key in shifts))return;
  event.preventDefault();const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+shifts[event.key]);
  const next=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if(!allowed(next))return;year=d.getFullYear();month=d.getMonth();
  queueMicrotask(()=>root.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus());
 }
</script>
<svelte:window onpointerdown={(event)=>{if(open&&root&&!root.contains(event.target as Node))open=false}} />
<div class="picker" bind:this={root}>
 <span class="label small fg3">{label}</span>
 <button class="trigger mono" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onclick={toggle}>{value||'Choose date'}<span aria-hidden="true">▦</span></button>
 {#if open}
  <div class="calendar" role="dialog" aria-label={label} tabindex="-1" onkeydown={keyboard}>
   <div class="month"><button aria-label="Previous month" onclick={()=>move(-1)}>‹</button><span>{monthName}</span><button aria-label="Next month" onclick={()=>move(1)}>›</button></div>
   <div class="grid">
    {#each ['Mo','Tu','We','Th','Fr','Sa','Su'] as day}<span class="weekday">{day}</span>{/each}
    {#each blanks as _}<span></span>{/each}
    {#each days as day}<button class:selected={value===key(day)} class:today={today===key(day)} aria-current={today===key(day)?'date':undefined} data-date={key(day)} aria-label={key(day)} aria-pressed={value===key(day)} disabled={!allowed(key(day))} onclick={()=>select(day)}>{day}</button>{/each}
   </div>
   <div class="today-label small fg3">Today · {today}</div>
   <div class="actions"><button onclick={()=>{const d=new Date(today+'T12:00:00');year=d.getFullYear();month=d.getMonth()}}>Show today</button><button onclick={close}>Done</button></div>
  </div>
 {/if}
</div>
<style>
 .picker{position:relative;display:flex;align-items:center;gap:8px}
 .trigger{display:flex;align-items:center;gap:18px;font-size:12px;padding:6px 9px;border:1px solid var(--line);border-radius:5px;background:var(--bg2);color:var(--fg);cursor:pointer}
 .trigger:hover{border-color:var(--fg3)}
 .calendar{position:absolute;left:0;top:calc(100% + 7px);z-index:60;width:252px;padding:12px;background:var(--bg2);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 28px #0003;color:var(--fg)}
 .month{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:10px}
 .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}
 .weekday{font-size:10px;color:var(--fg3);padding:4px 0}
 button{font:inherit;color:var(--fg);background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;padding:5px}
 .grid button{font-size:12px;aspect-ratio:1}
 button:hover:not(:disabled),button:focus-visible{border-color:var(--fg3);background:var(--bg)}
 .selected{background:var(--fg)!important;color:var(--bg)!important}
 .today{border-color:var(--focus);font-weight:600}
 .today-label{margin-top:10px;font-size:11px}
 button:disabled{opacity:.25;cursor:default}
 .actions{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:7px;margin-top:9px;font-size:11px}
</style>
