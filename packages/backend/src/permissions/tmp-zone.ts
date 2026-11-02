import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

let cachedRoots: string[] | undefined;

export function temporaryRoots(): string[] {
	if (cachedRoots) return cachedRoots;
	const roots = new Set<string>();
	const literal = resolve(tmpdir());
	roots.add(literal);
	try {
		roots.add(realpathSync(literal));
	} catch {}
	roots.add("/tmp");
	roots.add(resolve("/tmp"));
	try {
		roots.add(realpathSync("/tmp"));
	} catch {}
	cachedRoots = [...roots];
	return cachedRoots;
}

export function isTemporaryPath(abs: string): boolean {
	const target = resolve(abs);
	return temporaryRoots().some((root) => {
		const rel = relative(root, target);
		return !rel.startsWith("..") && !isAbsolute(rel);
	});
}

export function isRmSegment(segment: string): boolean {
	const first = segment.trim().split(/\s+/)[0] ?? "";
	return first === "rm";
}

interface SegmentToken {
	text: string;

	quoted: boolean;
}

function tokenizeSegment(segment: string): SegmentToken[] {
	const tokens: SegmentToken[] = [];
	let current = "";
	let quoted = false;
	let quote: string | null = null;
	const push = () => {
		if (current.length > 0 || quoted) {
			tokens.push({ text: current, quoted });
			current = "";
			quoted = false;
		}
	};
	for (const ch of segment) {
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			quoted = true;
			continue;
		}
		if (/\s/.test(ch)) {
			push();
			continue;
		}
		current += ch;
	}
	push();
	return tokens;
}

const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;

function isGlobToken(token: SegmentToken): boolean {
	return !token.quoted && /[*?]/.test(token.text);
}

export function rmSegmentExempt(segment: string, cwd?: string): boolean {
	if (!isRmSegment(segment)) return false;
	const tokens = tokenizeSegment(segment);
	const paths: SegmentToken[] = [];
	let endOfFlags = false;
	for (const token of tokens.slice(1)) {
		if (!endOfFlags && !token.quoted && token.text === "--") {
			endOfFlags = true;
			continue;
		}

		if (!endOfFlags && !token.quoted && token.text.startsWith("-") && token.text.length > 1) {
			continue;
		}

		if (!endOfFlags && paths.length === 0 && !token.quoted && ASSIGNMENT_PREFIX.test(token.text)) {
			continue;
		}
		paths.push(token);
	}
	if (paths.length === 0) return false;
	if (cwd === undefined && paths.some((p) => !isAbsolute(p.text))) return false;
	return paths.every((token) => {
		const literal = isGlobToken(token) ? dirname(token.text) : token.text;
		return isAbsolute(literal)
			? isTemporaryPath(literal)
			: cwd !== undefined && isTemporaryPath(resolve(cwd, literal));
	});
}
