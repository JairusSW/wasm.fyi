<script lang="ts">
 // Release version change: diamond. Commit-pinned change: circle. Did not pass: same shape, hollow.
 // `hot`: the hovered point — the same marker, just larger.
 let {x,y,color,version='',commit=false,selected=false,partial=false,hot=false}: {x:string;y:string;color:string;version?:string;commit?:boolean;selected?:boolean;partial?:boolean;hot?:boolean}=$props();
</script>

<span class="history-marker" class:version-marker={!!version} class:commit={!!version&&commit} class:selected class:partial class:hot style:left={x} style:top={y} style:background={partial?'var(--bg2)':color} style:border-color={partial?color:undefined} aria-hidden="true"></span>

<style>
 .history-marker {
  --s: 1;
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(var(--s));
  transition: transform 0.12s ease;
  pointer-events: none;
 }
 .hot { --s: 1.25; z-index: 2; }
 .selected { width: 7px; height: 7px; }
 .version-marker {
  width: 8px;
  height: 8px;
  border: 1px solid var(--bg2);
  border-radius: 0;
  transform: translate(-50%, -50%) scale(var(--s)) rotate(45deg);
 }
 .version-marker.commit {
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(var(--s));
 }
 .partial {
  border: 1.5px solid;
  box-sizing: border-box;
 }
 .partial:not(.version-marker) { width: 7px; height: 7px; }
</style>
