export interface PatchLine {
	kind: "ctx" | "add" | "del";

	oldNo: number | null;

	newNo: number | null;

	text: string;
}

export interface PatchHunk {
	oldStart: number;
	newStart: number;

	header: string;
	lines: PatchLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string): PatchHunk[] {
	if (typeof patch !== "string" || patch.length === 0) return [];
	const raw = patch.split("\n");

	if (raw[raw.length - 1] === "") raw.pop();
	const hunks: PatchHunk[] = [];
	let current: PatchHunk | null = null;
	let oldNo = 0;
	let newNo = 0;
	for (const line of raw) {
		if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
		const m = HUNK_RE.exec(line);
		if (m) {
			oldNo = Number(m[1]);
			newNo = Number(m[2]);
			current = { oldStart: oldNo, newStart: newNo, header: line, lines: [] };
			hunks.push(current);
			continue;
		}

		if (!current || line.startsWith("\\")) continue;
		const tag = line[0];
		if (tag === "+") {
			current.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text: line.slice(1) });
		} else if (tag === "-") {
			current.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text: line.slice(1) });
		} else {
			current.lines.push({
				kind: "ctx",
				oldNo: oldNo++,
				newNo: newNo++,
				text: tag === " " ? line.slice(1) : line,
			});
		}
	}
	return hunks;
}

export function patchStat(patch: string): { added: number; removed: number } {
	if (typeof patch !== "string" || patch.length === 0) return { added: 0, removed: 0 };
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+")) {
			if (!line.startsWith("+++")) added++;
		} else if (line.startsWith("-")) {
			if (!line.startsWith("---")) removed++;
		}
	}
	return { added, removed };
}
