// A tiny, safe arithmetic language for derived metrics. Parsed to an AST and
// evaluated by walking it — never `eval`. Unknown identifiers are errors, and a
// missing variable makes the whole result missing (never zero).

export type Node =
	| { k: 'num'; v: number }
	| { k: 'var'; name: string }
	| { k: 'neg'; a: Node }
	| { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
	| { k: 'call'; fn: string; args: Node[] };

export const FUNCTIONS: Record<string, { arity: [number, number]; fn: (...x: number[]) => number; doc: string }> = {
	log: { arity: [1, 1], fn: Math.log, doc: 'natural log' },
	log10: { arity: [1, 1], fn: Math.log10, doc: 'base-10 log' },
	log2: { arity: [1, 1], fn: Math.log2, doc: 'base-2 log' },
	sqrt: { arity: [1, 1], fn: Math.sqrt, doc: 'square root' },
	abs: { arity: [1, 1], fn: Math.abs, doc: 'absolute value' },
	exp: { arity: [1, 1], fn: Math.exp, doc: 'e^x' },
	min: { arity: [1, 16], fn: Math.min, doc: 'smallest argument' },
	max: { arity: [1, 16], fn: Math.max, doc: 'largest argument' },
	round: { arity: [1, 1], fn: Math.round, doc: 'nearest integer' }
};

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function lex(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		const num = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
		if (num) {
			out.push({ t: 'num', v: Number(num[0].replace(/_/g, '')) });
			i += num[0].length;
			continue;
		}
		const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
		if (id) {
			out.push({ t: 'id', v: id[0] });
			i += id[0].length;
			continue;
		}
		if ('+-*/^(),'.includes(c)) {
			out.push({ t: 'op', v: c });
			i++;
			continue;
		}
		throw new Error(`Unexpected “${c}” at position ${i + 1}`);
	}
	return out;
}

/** Parses `src`; every identifier must be in `vars` or be a function call. */
export function parse(src: string, vars: readonly string[]): Node {
	const toks = lex(src);
	let p = 0;
	const peek = () => toks[p];
	const eat = (v?: string) => {
		const t = toks[p];
		if (!t || (v != null && t.v !== v)) throw new Error(v ? `Expected “${v}”` : 'Unexpected end of expression');
		p++;
		return t;
	};
	// expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ; unary := '-' unary | pow ; pow := atom ('^' unary)?
	const expr = (): Node => {
		let a = term();
		while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
			const op = eat().v as '+' | '-';
			a = { k: 'bin', op, a, b: term() };
		}
		return a;
	};
	const term = (): Node => {
		let a = unary();
		while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) {
			const op = eat().v as '*' | '/';
			a = { k: 'bin', op, a, b: unary() };
		}
		return a;
	};
	const unary = (): Node => {
		if (peek()?.t === 'op' && peek().v === '-') {
			eat();
			return { k: 'neg', a: unary() };
		}
		if (peek()?.t === 'op' && peek().v === '+') {
			eat();
			return unary();
		}
		const a = atom();
		if (peek()?.t === 'op' && peek().v === '^') {
			eat();
			return { k: 'bin', op: '^', a, b: unary() };
		}
		return a;
	};
	const atom = (): Node => {
		const t = eat();
		if (t.t === 'num') return { k: 'num', v: t.v };
		if (t.t === 'op' && t.v === '(') {
			const e = expr();
			eat(')');
			return e;
		}
		if (t.t === 'id') {
			if (peek()?.t === 'op' && peek().v === '(') {
				const f = FUNCTIONS[t.v];
				if (!f) throw new Error(`Unknown function “${t.v}”`);
				eat('(');
				const args: Node[] = [];
				if (!(peek()?.t === 'op' && peek().v === ')')) {
					args.push(expr());
					while (peek()?.t === 'op' && peek().v === ',') {
						eat(',');
						args.push(expr());
					}
				}
				eat(')');
				if (args.length < f.arity[0] || args.length > f.arity[1]) throw new Error(`${t.v}() takes ${f.arity.join('–')} argument(s)`);
				return { k: 'call', fn: t.v, args };
			}
			if (!vars.includes(t.v)) throw new Error(`Unknown variable “${t.v}”. Available: ${vars.join(', ')}`);
			return { k: 'var', name: t.v };
		}
		throw new Error(`Unexpected “${t.v}”`);
	};
	if (!toks.length) throw new Error('Empty expression');
	const node = expr();
	if (p < toks.length) throw new Error(`Unexpected “${toks[p].v}”`);
	return node;
}

/** Evaluates; returns null when any referenced variable is missing or the result is not finite. */
export function evaluate(node: Node, env: Record<string, number | null | undefined>): number | null {
	const go = (n: Node): number | null => {
		switch (n.k) {
			case 'num':
				return n.v;
			case 'var': {
				const v = env[n.name];
				return v == null || !Number.isFinite(v) ? null : v;
			}
			case 'neg': {
				const a = go(n.a);
				return a == null ? null : -a;
			}
			case 'bin': {
				const a = go(n.a);
				const b = go(n.b);
				if (a == null || b == null) return null;
				return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : a ** b;
			}
			case 'call': {
				const args = n.args.map(go);
				if (args.some((x) => x == null)) return null;
				return FUNCTIONS[n.fn].fn(...(args as number[]));
			}
		}
	};
	const v = go(node);
	return v == null || !Number.isFinite(v) ? null : v;
}

/** Variables referenced by an expression. */
export function variables(node: Node, out = new Set<string>()): Set<string> {
	if (node.k === 'var') out.add(node.name);
	else if (node.k === 'neg') variables(node.a, out);
	else if (node.k === 'bin') {
		variables(node.a, out);
		variables(node.b, out);
	} else if (node.k === 'call') node.args.forEach((a) => variables(a, out));
	return out;
}

/** Parse result for UI validation. */
export function check(src: string, vars: readonly string[]): { ok: true; node: Node } | { ok: false; error: string } {
	try {
		return { ok: true, node: parse(src, vars) };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
