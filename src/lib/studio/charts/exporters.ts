// Download helpers. CSS custom properties are resolved before serializing so
// exported SVG/PNG files look the same outside the page.

export function download(name: string, data: Blob | string, type = 'text/plain') {
	const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
	const url = URL.createObjectURL(blob);
	const a = Object.assign(document.createElement('a'), { href: url, download: name });
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart';

/** Inline computed paint/text styles so the SVG is standalone. */
export function standaloneSvg(svg: SVGSVGElement): string {
	const clone = svg.cloneNode(true) as SVGSVGElement;
	const src = svg.querySelectorAll('*');
	const dst = clone.querySelectorAll('*');
	const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight'];
	src.forEach((el, i) => {
		const cs = getComputedStyle(el);
		const out = dst[i] as SVGElement;
		out.setAttribute('style', props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
		out.removeAttribute('class');
		out.removeAttribute('data-tip');
	});
	const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg2') || '#fff';
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	clone.insertAdjacentHTML('afterbegin', `<rect width="100%" height="100%" fill="${bg.trim()}"/>`);
	return new XMLSerializer().serializeToString(clone);
}

export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
	const text = standaloneSvg(svg);
	const w = svg.width.baseVal.value;
	const h = svg.height.baseVal.value;
	const img = new Image();
	img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
	await img.decode();
	const canvas = Object.assign(document.createElement('canvas'), { width: w * scale, height: h * scale });
	const ctx = canvas.getContext('2d')!;
	ctx.scale(scale, scale);
	ctx.drawImage(img, 0, 0);
	return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG export failed'))), 'image/png'));
}
