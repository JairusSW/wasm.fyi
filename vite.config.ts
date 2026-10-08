import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
	plugins: [sveltekit()],
	// Collection evidence and CAS objects are read by the Go service, not Vite.
	server: { watch: { ignored: ['.wasmbench', '.wasmfyi', 'data', 'static/wasmbench', 'build'].map(directory => resolve(directory) + '/**') } },
	test: { include: ['src/**/*.test.ts'], setupFiles: ['src/lib/testing/setup.ts'] }
});
