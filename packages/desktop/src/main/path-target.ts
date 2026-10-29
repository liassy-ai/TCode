import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WRAPPERS: readonly [string, string][] = [
	["`", "`"],
	['"', '"'],
	["'", "'"],
	["<", ">"],
	["(", ")"],
	["[", "]"],
];

const LINE_SUFFIXES = [/:\d+(?::\d+)?$/, /#L\d+(?:[-–]L?\d+)?(?:C\d+)?$/i];

function decodePercent(text: string): string {
	if (!text.includes("%")) return text;
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

function fromFileUrl(text: string): string {
	try {
		return fileURLToPath(text);
	} catch {
		return decodePercent(text.replace(/^file:\/\//i, ""));
	}
}

export function cleanPathText(raw: string): string {
	let text = raw.trim();
	let changed = true;
	while (changed) {
		changed = false;
		for (const [open, close] of WRAPPERS) {
			if (text.length > 1 && text.startsWith(open) && text.endsWith(close)) {
				text = text.slice(1, -1).trim();
				changed = true;
				break;
			}
		}
	}

	text = text.trim();
	for (const pattern of LINE_SUFFIXES) text = text.replace(pattern, "");
	return text.trim();
}

export function resolvePathTarget(raw: string, cwd: string | null): string {
	const cleaned = cleanPathText(raw);
	if (!cleaned) throw new Error(`Empty path: ${JSON.stringify(raw)}`);
	let text = /^file:\/\//i.test(cleaned) ? fromFileUrl(cleaned) : decodePercent(cleaned);
	if (text === "~") text = homedir();
	else if (text.startsWith("~/")) text = join(homedir(), text.slice(2));
	const base = cwd && isAbsolute(cwd) ? cwd : process.cwd();
	return isAbsolute(text) ? normalize(text) : resolve(base, text);
}

export function resolveExistingPath(raw: string, cwd: string | null): string {
	const resolved = resolvePathTarget(raw, cwd);
	if (!existsSync(resolved)) throw new Error(`Path not found: ${resolved}`);
	return resolved;
}
