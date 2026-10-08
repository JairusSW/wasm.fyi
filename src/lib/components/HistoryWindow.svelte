<script lang="ts">
 import {apiHistory} from '$lib/api/history.svelte';
 import {datasetView,viewData} from '$lib/api/view.svelte';
 import DatePicker from './DatePicker.svelte';
 import {ui} from '$lib/state.svelte';
 import {page} from '$app/state';
 import {localDate} from '$lib/api/calendar-date';
 const scope=$derived(ui.machine+'|'+(page.route.id==='/bench/[...id]'?'exec':ui.otMetric)+'|'+(page.route.id==='/bench/[...id]'?page.params.id?.replace(/\/$/,'')||'':''));
 const dates=$derived(datasetView.revision?apiHistory.captureDates[scope]?.filter(date=>date<=localDate())||[]:viewData.history[ui.machine].points.map(p=>p.date));
 const from=$derived(datasetView.revision?apiHistory.from:dates[ui.histFrom]||'');
 const until=$derived(datasetView.revision?apiHistory.until:dates[ui.histTo]||'');
 function setFrom(value:string){if(datasetView.revision)apiHistory.from=value;else {const index=dates.indexOf(value);if(index>=0)ui.histFrom=index;}}
 function setUntil(value:string){if(datasetView.revision)apiHistory.until=value;else {const index=dates.indexOf(value);if(index>=0)ui.histTo=index;}}
</script>
<div class="row small">
 <DatePicker label="History from" bind:value={()=>from,setFrom} max={until} {dates} />
 <DatePicker label="Until" bind:value={()=>until,setUntil} min={from} {dates} />
</div>
