<script lang="ts">
	/** Full logo, or just the dot-matrix mark (`mark`) at the logo's height. */
	let { width = 136, mark = false }: { width?: number; mark?: boolean } = $props();
	const height = $derived(width * 212 / 1200);
	const file = $derived(mark ? 'logo-mark' : 'logo');
</script>

<span class="logo" style:width="{mark ? height : width}px" style:height="{height}px" style:--brand-light="url('/brand/{file}-black.png')" style:--brand-dark="url('/brand/{file}-white.png')" role="img" aria-label="wasm.fyi"></span>

<style>
 .logo { display:inline-block;position:relative;flex:none;vertical-align:middle;max-width:100%;background:var(--brand-dark) center / contain no-repeat; }
 :global(html[data-theme='light']) .logo { background-image:var(--brand-light); }
</style>
