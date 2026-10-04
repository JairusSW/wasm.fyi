import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		outDir: process.env.WASMFYI_KIT_OUT_DIR || '.svelte-kit',
		adapter: adapter({ fallback: '404.html' }),
		paths: { base: process.env.BASE_PATH || '' },
		prerender: { handleHttpError: 'fail' }
	}
};

export default config;
