export interface AtToken {
	start: number;

	end: number;

	query: string;
}

export function extractAtToken(text: string, cursor: number): AtToken | null {
	const before = text.slice(0, cursor);
	const at = before.lastIndexOf("@");
	if (at === -1) return null;

	if (at > 0 && /[A-Za-z0-9_.\-@]/.test(before[at - 1] ?? "")) return null;
	const query = before.slice(at + 1);
	if (/\s/.test(query)) return null;
	return { start: at, end: cursor, query };
}

export function fuzzyScore(query: string, target: string): number | null {
	if (!query) return 0;
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	let score = 0;
	let qi = 0;
	let lastMatch = -2;
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] !== q[qi]) continue;
		score += 1;
		if (lastMatch === ti - 1) score += 3;
		const prev = ti === 0 ? "/" : (target[ti - 1] ?? "");
		if (prev === "/" || prev === "-" || prev === "_" || prev === ".") score += 4;
		if (target[ti] !== t[ti]) score += 2;
		lastMatch = ti;
		qi++;
	}
	if (qi < q.length) return null;
	return score - target.length * 0.01;
}

export function filterFiles(files: string[], query: string, limit = 50): string[] {
	if (!query) return files.slice(0, limit);
	return files
		.map((f) => ({ f, s: fuzzyScore(query, f) }))
		.filter((x): x is { f: string; s: number } => x.s !== null)
		.sort((a, b) => b.s - a.s)
		.slice(0, limit)
		.map((x) => x.f);
}
