import { patchStat } from "./parse-patch";
import type { UIMessage, UIToolCall } from "./types";

export interface DiffSection {
	toolCallKey: string;
	kind: "edit" | "write";

	patch?: string;

	content?: string;
}

export interface TurnFileChange {
	path: string;
	added: number;
	removed: number;
	sections: DiffSection[];
}

export interface TurnChanges {
	turnIndex: number;
	files: TurnFileChange[];
	totalAdded: number;
	totalRemoved: number;

	checkpointSha?: string;
}

const FILE_TOOL_NAMES = new Set(["edit", "write"]);

function parseToolArgs(args: string): Record<string, unknown> | null {
	try {
		const v: unknown = JSON.parse(args);
		return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function sectionFromTool(
	tool: UIToolCall,
): { path: string; section: DiffSection; added: number; removed: number } | null {
	const args = parseToolArgs(tool.args);
	const path = typeof args?.path === "string" && args.path.length > 0 ? args.path : null;
	if (!path) return null;
	if (tool.name === "edit") {
		if (!tool.diff) return null;
		const stat = patchStat(tool.diff);
		if (stat.added === 0 && stat.removed === 0) return null;
		return { path, section: { toolCallKey: tool.key, kind: "edit", patch: tool.diff }, ...stat };
	}

	const content = typeof args?.content === "string" ? args.content : "";
	if (content.length === 0) return null;
	return {
		path,
		section: { toolCallKey: tool.key, kind: "write", content },
		added: content.split("\n").length,
		removed: 0,
	};
}

export function deriveTurnChanges(messages: UIMessage[]): TurnChanges[] {
	const turns: TurnChanges[] = [];
	let turnIndex = -1;
	let files = new Map<string, TurnFileChange>();

	const flush = (): void => {
		if (files.size === 0) return;
		const list = [...files.values()];
		turns.push({
			turnIndex,
			files: list,
			totalAdded: list.reduce((s, f) => s + f.added, 0),
			totalRemoved: list.reduce((s, f) => s + f.removed, 0),
		});
	};

	for (const m of messages) {
		if (m.kind === "user") {
			flush();
			turnIndex++;
			files = new Map();
			continue;
		}

		if (m.kind !== "assistant" || turnIndex < 0) continue;
		for (const tool of m.tools) {
			if (tool.state === "error" || !FILE_TOOL_NAMES.has(tool.name)) continue;
			const parsed = sectionFromTool(tool);
			if (!parsed) continue;
			const existing = files.get(parsed.path);
			if (existing) {
				existing.added += parsed.added;
				existing.removed += parsed.removed;
				existing.sections.push(parsed.section);
			} else {
				files.set(parsed.path, {
					path: parsed.path,
					added: parsed.added,
					removed: parsed.removed,
					sections: [parsed.section],
				});
			}
		}
	}
	flush();
	return turns;
}
