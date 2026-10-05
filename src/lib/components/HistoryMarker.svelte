<script lang="ts">
 let {x,y,color,version='',selected=false}: {x:string;y:string;color:string;version?:string;selected?:boolean}=$props();
</script>

<span class="history-marker" class:version-marker={!!version} class:selected style:left={x} style:top={y} style:background={color} title={version ? `Version ${version}` : undefined} aria-hidden="true"></span>

<style>
 .history-marker {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
 }
 .selected { width: 7px; height: 7px; }
 .version-marker {
  width: 8px;
  height: 8px;
  border: 1px solid var(--bg2);
  border-radius: 0;
  transform: translate(-50%, -50%) rotate(45deg);
 }
</style>
