import type { AgentSession, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { isSubagentToolName } from "@tcode/shared";

export interface ShadowedSubagentExtension {
	extensionPath: string;
	tools: string[];
}

export interface SubagentMutexResult {
	shadowed: ShadowedSubagentExtension[];
	disabledToolNames: string[];
}

function isSubagentFamily(name: string): boolean {
	return name !== "subagent" && isSubagentToolName(name);
}

export function resolveSubagentPreferBuiltin(
	option: boolean | undefined,
	stored: boolean | undefined,
): boolean {
	return option ?? stored ?? true;
}

export function applySubagentMutex(
	session: Pick<AgentSession, "getActiveToolNames" | "setActiveToolsByName">,
	extensionsResult: LoadExtensionsResult,
	preferBuiltin: boolean,
): SubagentMutexResult {
	if (!preferBuiltin) return { shadowed: [], disabledToolNames: [] };
	const shadowed: ShadowedSubagentExtension[] = [];
	const disabled = new Set<string>();
	for (const extension of extensionsResult.extensions) {
		const tools = [...extension.tools.keys()].filter((name) => name === "subagent" || isSubagentFamily(name));
		if (tools.length === 0) continue;
		shadowed.push({ extensionPath: extension.path, tools });
		for (const name of tools) if (isSubagentFamily(name)) disabled.add(name);
	}
	if (disabled.size > 0) {
		session.setActiveToolsByName(session.getActiveToolNames().filter((name) => !disabled.has(name)));
	}
	return { shadowed, disabledToolNames: [...disabled] };
}
