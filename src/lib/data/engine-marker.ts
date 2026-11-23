import type { Cfg, MarkerPattern } from './types';

interface RuntimeMarkers {
	color?: string;
	modes: Partial<Record<MarkerPattern, string>>;
}

const families: Record<string, RuntimeMarkers> = {
	wago: {color: 'var(--rt-wago)', modes: {solid: 'wago-go', hollow: 'wago-tinygo'}},
	wasmtime: {color: 'var(--rt-wasmtime)', modes: {solid: 'wasmtime', hollow: 'wasmtime-winch'}},
	wasmer: {color: 'var(--rt-wasmer)', modes: {solid: 'wasmer-cranelift', hollow: 'wasmer-singlepass', diagonal: 'wasmer-llvm'}},
	wazero: {color: 'var(--rt-wazero)', modes: {solid: 'wazero', hollow: 'wazero-interpreter'}},
	wamr: {modes: {solid: 'wamr', hollow: 'wamr-fast-jit', diagonal: 'wamr-llvm-jit', split: 'wamr-aot'}},
	wasmedge: {modes: {solid: 'wasmedge', hollow: 'wasmedge-jit', diagonal: 'wasmedge-aot'}},
	chicory: {modes: {solid: 'chicory', hollow: 'chicory-jit'}},
	endive: {modes: {solid: 'endive-interpreter', hollow: 'endive-jit'}},
	wizard: {modes: {solid: 'wizard-v3-int', hollow: 'wizard-fast-int', diagonal: 'wizard-spc'}},
	zwasm: {modes: {solid: 'zwasm-interpreter', hollow: 'zwasm-jit', diagonal: 'zwasm-aot'}},
	libwasm: {modes: {solid: 'libwasm', hollow: 'libwasm-jit'}},
};

function engineColor(engine: string) {
	let hash = 0;
	for (const c of engine) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
	return `hsl(${hash % 360} 65% 60%)`;
}

export function engineMarker(engine: string) {
	const family = engine.split('-')[0];
	const markers = Object.hasOwn(families, family) ? families[family] : undefined;
	const runtime = markers ? family : engine.replace(/-gcc$/, '');
	const pattern = (Object.keys(markers?.modes ?? {}) as MarkerPattern[]).find(key => markers?.modes[key] === engine)
		?? (engine === 'wago-beta.11' ? 'hollow' : 'solid');
	return { runtime, color: markers?.color ?? engineColor(markers?.modes.solid ?? engine), pattern };
}

export function markerDash({ pattern, hollow }: Pick<Cfg, 'pattern' | 'hollow'>) {
	switch (pattern) {
		case 'diagonal': return '2 2';
		case 'split': return '6 2 2 2';
		default: return hollow ? '4 3' : 'none';
	}
}
