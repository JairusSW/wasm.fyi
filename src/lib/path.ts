/** Prefix local links for project-path hosting without changing the UI. */
export function hostedPath(path: string, base: string): string {
	if (!base || !path.startsWith('/') || path.startsWith('//') || path === base || path.startsWith(base + '/') || path.startsWith(base + '?') || path.startsWith(base + '#')) return path;
	return base + path;
}
