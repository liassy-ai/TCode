import { homedir } from "node:os";
import { dirname, sep } from "node:path";
import { collectBashCandidates } from "./bash-chain";

export type PermissionAction = "allow" | "ask" | "deny";

export type PermissionRule = PermissionAction | Record<string, PermissionAction>;

export interface PermissionRules {
	"*"?: PermissionAction;
	[toolName: string]: PermissionRule | undefined;
}

export interface PermissionOutside {
	read: PermissionAction;

	write: PermissionAction;

	temporary: PermissionAction;
}

const ACTIONS: ReadonlySet<string> = new Set(["allow", "ask", "deny"]);

export function matchPattern(pattern: string, text: string): boolean {
	const regex = pattern
		.split("")
		.map((ch) => {
			if (ch === "*") return ".*";
			if (ch === "?") return ".";
			return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		})
		.join("");
	return new RegExp(`^${regex}$`).test(text);
}

const ACTION_PRIORITY: Record<PermissionAction, number> = { allow: 0, ask: 1, deny: 2 };

function evaluateSingle(
	rules: PermissionRules,
	toolName: string,
	matchText: string | null,
	fallback: PermissionAction,
): PermissionAction {
	let action = fallback;
	const globalRule = rules["*"];
	if (globalRule && ACTIONS.has(globalRule)) {
		action = globalRule;
	}
	const toolRule = rules[toolName];
	if (!toolRule) return action;
	if (ACTIONS.has(toolRule as string)) {
		return toolRule as PermissionAction;
	}
	if (typeof toolRule === "object" && matchText !== null) {
		for (const [pattern, patternAction] of Object.entries(toolRule)) {
			if (ACTIONS.has(patternAction) && matchPattern(pattern, matchText)) {
				action = patternAction;
			}
		}
	}
	return action;
}

export function evaluateBashCommand(
	rules: PermissionRules,
	command: string,
	fallback: PermissionAction = "ask",
	segmentOverride?: (segment: string) => PermissionAction | null,
): { action: PermissionAction; segment: string } {
	let action: PermissionAction = "allow";
	let segment = command;
	for (const candidate of collectBashCandidates(command)) {
		let a = evaluateSingle(rules, "bash", candidate, fallback);
		if (segmentOverride) {
			const override = segmentOverride(candidate);

			if (override !== null && a !== "deny") a = override;
		}
		const priority = ACTION_PRIORITY[a];
		if (priority > ACTION_PRIORITY[action] || (segmentOverride && priority === ACTION_PRIORITY[action])) {
			action = a;
			segment = candidate;
		}
	}
	return { action, segment };
}

export function evaluateRules(
	rules: PermissionRules,
	toolName: string,
	matchText: string | null,
	fallback: PermissionAction = "ask",
): PermissionAction {
	if (toolName === "bash" && matchText !== null) {
		return evaluateBashCommand(rules, matchText, fallback).action;
	}
	return evaluateSingle(rules, toolName, matchText, fallback);
}

export function matchTextFor(toolName: string, input: Record<string, unknown>): string | null {
	const value = (() => {
		switch (toolName) {
			case "bash":
				return input.command;
			case "read":
			case "edit":
			case "write":
			case "ls":
				return input.path;
			case "show_image": {
				const paths = input.paths;
				return Array.isArray(paths) ? paths[0] : input.path;
			}
			case "grep":
			case "find":
				return input.pattern;
			default:
				return undefined;
		}
	})();
	return typeof value === "string" && value.length > 0 ? value : null;
}

function tooBroadDir(dir: string, home: string): boolean {
	return dir === "/" || dir === home || home.startsWith(dir + sep) || dir === dirname(home);
}

function pathToolPattern(toolName: string, path: string, home: string): string {
	const dir = dirname(path);
	return tooBroadDir(dir, home) ? `${toolName}: ${path}` : `${toolName}: ${dir}${sep}*`;
}

const PATH_PATTERN_TOOLS = new Set(["read", "edit", "write", "ls", "show_image"]);

export function suggestPattern(toolName: string, input: Record<string, unknown>): string {
	const matchText = matchTextFor(toolName, input);
	if (toolName === "bash" && matchText) {
		const tokens = matchText.trim().split(/\s+/);
		const first = tokens[0] ?? "";
		const second = tokens[1] ?? "";
		if (first && /^(?:[a-zA-Z][a-zA-Z0-9-]*|-[a-zA-Z][a-zA-Z0-9-]*)$/.test(second)) {
			return `bash: ${first} ${second}*`;
		}
		return `bash: ${first}*`;
	}
	if (matchText) {
		if (PATH_PATTERN_TOOLS.has(toolName)) {
			return pathToolPattern(toolName, matchText, homedir());
		}
		return `${toolName}: ${matchText}`;
	}
	return toolName;
}

export function patternMatchesToolCall(pattern: string, toolName: string, matchText: string | null): boolean {
	const idx = pattern.indexOf(": ");
	const pTool = idx > 0 ? pattern.slice(0, idx) : pattern;
	const pText = idx > 0 ? pattern.slice(idx + 2) : null;
	if (pTool !== toolName) return false;
	if (pText === null) return true;
	if (matchText === null) return false;
	if (toolName === "bash") {
		return collectBashCandidates(matchText).some((c) => matchPattern(pText, c));
	}
	return matchPattern(pText, matchText);
}
