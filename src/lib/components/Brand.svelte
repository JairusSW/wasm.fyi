<script lang="ts">
	/** Full logo, or just the dot-matrix mark (`mark`) at the logo's height. */
	let { width = 136, mark = false }: { width?: number; mark?: boolean } = $props();
	const height = $derived(width * 212 / 1200);
	const file = $derived(mark ? 'logo-mark' : 'logo');
</script>

<span class="logo" style:width="{mark ? height : width}px" style:height="{height}px" role="img" aria-label="wasm.fyi">
	<img class="black" src="/brand/{file}-black.png" alt="" width={mark ? 512 : 1200} height={mark ? 512 : 212} />
	<img class="white" src="/brand/{file}-white.png" alt="" width={mark ? 512 : 1200} height={mark ? 512 : 212} />
</span>

<style>
	.logo { display: inline-block; position: relative; flex: none; vertical-align: middle; max-width: 100%; }
	img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
	.black { display: none; }
	:global(html[data-theme='light']) .black { display: block; }
	:global(html[data-theme='light']) .white { display: none; }
</style>
