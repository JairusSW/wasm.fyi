// A deliberately small Markdown subset for note blocks. Text is HTML-escaped
// first; only links with http(s), mailto or site-relative URLs are emitted.
// Shared layouts arrive via URL, so this must never pass raw HTML through.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeUrl = (u: string) => (/^(https?:\/\/|mailto:|\/(?!\/)|#|\?)/i.test(u) ? u : null);

function inline(src: string): string {
	let s = esc(src);
	s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
	s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
		const u = safeUrl(url.replace(/&amp;/g, '&'));
		return u ? `<a href="${esc(u)}"${/^https?:/i.test(u) ? ' rel="noopener noreferrer" target="_blank"' : ''}>${text}</a>` : m;
	});
	return s;
}

export function renderMarkdown(src: string): string {
	const out: string[] = [];
	let list: 'ul' | 'ol' | null = null;
	let para: string[] = [];
	const flushPara = () => {
		if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
		para = [];
	};
	const flushList = () => {
		if (list) out.push(`</${list}>`);
		list = null;
	};
	for (const raw of src.split('\n')) {
		const line = raw.trimEnd();
		const h = /^(#{1,3})\s+(.*)$/.exec(line);
		const ul = /^\s*[-*]\s+(.*)$/.exec(line);
		const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		if (!line.trim()) {
			flushPara();
			flushList();
		} else if (h) {
			flushPara();
			flushList();
			out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`);
		} else if (/^---+$/.test(line.trim())) {
			flushPara();
			flushList();
			out.push('<hr>');
		} else if (ul || ol) {
			flushPara();
			const kind = ul ? 'ul' : 'ol';
			if (list !== kind) {
				flushList();
				out.push(`<${kind}>`);
				list = kind;
			}
			out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
		} else if (/^>\s?/.test(line)) {
			flushPara();
			flushList();
			out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
		} else {
			flushList();
			para.push(line.trim());
		}
	}
	flushPara();
	flushList();
	return out.join('\n');
}
