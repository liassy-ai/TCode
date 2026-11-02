import { ASK_TOOL_NAMES, countAskQuestions } from "./ask-questions";
import type { UIToolCall } from "./types";

export type ToolCategory = "read" | "edit" | "explore" | "search" | "bash" | "ptc" | "other" | "subagent";

export function categoryOf(toolName: string): ToolCategory {
	switch (toolName) {
		case "read":
			return "read";
		case "edit":
		case "write":
			return "edit";
		case "ls":
		case "glob":
			return "explore";
		case "grep":
			return "search";
		case "bash":
			return "bash";
		case "run_code":
			return "ptc";
		default:
			return "other";
	}
}

export interface MetaDot {
	key: string;
	state: "running" | "done" | "error";
}

const EXCLUDED_TOOLS = new Set(["subagent"]);

const PTC_ID_MARK = ":ptc:";

export function ptcParentIdOf(tool: UIToolCall): string | null {
	const at = tool.id.indexOf(PTC_ID_MARK);
	return at > 0 ? tool.id.slice(0, at) : null;
}

function mergeDotState(a: MetaDot["state"], b: MetaDot["state"]): MetaDot["state"] {
	if (a === "error" || b === "error") return "error";
	if (a === "running" || b === "running") return "running";
	return "done";
}

export function dotsFromItems(items: ReadonlyArray<{ tools: UIToolCall[] }>): MetaDot[] {
	const dots: MetaDot[] = [];

	const segments = new Map<string, { category: ToolCategory; at: number }>();
	for (const item of items) {
		for (const tool of item.tools) {
			if (EXCLUDED_TOOLS.has(tool.name)) continue;
			const round = ptcParentIdOf(tool);
			if (round === null) {
				if (tool.name === "run_code") continue;
				dots.push({ key: tool.key, state: tool.state });
				continue;
			}
			const category = categoryOf(tool.name);
			const segment = segments.get(round);
			if (segment && segment.category === category) {
				const existing = dots[segment.at];
				if (existing)
					dots[segment.at] = { key: existing.key, state: mergeDotState(existing.state, tool.state) };
				continue;
			}
			segments.set(round, { category, at: dots.length });
			dots.push({ key: tool.key, state: tool.state });
		}
	}
	return dots;
}

export interface SummarySegment {
	key: string;
	category: ToolCategory;

	name: string;
	count: number;
}

export function summarizeCategories(
	items: ReadonlyArray<{ tools: UIToolCall[] }>,
	subagentCount = 0,
): SummarySegment[] {
	const segments = new Map<string, SummarySegment>();
	for (const item of items) {
		for (const tool of item.tools) {
			if (EXCLUDED_TOOLS.has(tool.name) || tool.name === "show_image") continue;
			const category = categoryOf(tool.name);
			const key = category === "other" ? tool.name : category;

			const weight = ASK_TOOL_NAMES.has(tool.name) ? countAskQuestions(tool.args) : 1;
			const existing = segments.get(key);
			if (existing) existing.count += weight;
			else segments.set(key, { key, category, name: tool.name, count: weight });
		}
	}
	const result = [...segments.values()];
	if (subagentCount > 0) {
		result.push({ key: "subagent", category: "subagent", name: "subagent", count: subagentCount });
	}
	return result;
}
