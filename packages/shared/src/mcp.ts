export type McpExposure = "direct" | "deferred" | "codemode" | "hidden";

export type McpTransportView =
	| { kind: "stdio"; command: string; args?: string[] }
	| { kind: "url"; url: string }
	| { kind: "unknown" };

export interface McpToolView {
	name: string;

	readOnly?: boolean;
}

export interface McpServerStatus {
	name: string;

	tools: McpToolView[];

	error?: string;

	needsAuth?: boolean;

	authUrl?: string;
}

export interface McpServerView {
	name: string;

	scope: "user" | "project";

	transport: McpTransportView;

	description?: string;

	enabled: boolean;

	exposureRaw?: McpExposure;

	exposure: McpExposure;

	toolExposure?: Record<string, McpExposure>;

	headers?: Record<string, string>;

	overrideOnly?: boolean;

	tools: McpToolView[];

	error?: string;

	needsAuth?: boolean;

	authUrl?: string;
}

export interface McpConfigListResult {
	global: McpServerView[];

	project: McpServerView[];

	errors: string[];

	projectTrusted: boolean;

	globalPath: string;

	projectPath?: string;
}

export interface McpUpsertInput {
	scope: "user" | "project";

	cwd?: string;

	name: string;

	transport: "stdio" | "http";

	command?: string;

	args?: string[];

	url?: string;

	headers?: Record<string, string>;

	description?: string;

	enabled?: boolean;

	exposure?: McpExposure;

	toolExposure?: Record<string, McpExposure>;
}

export interface McpServersChangedPayload {
	servers: McpServerStatus[];
}

export interface McpReloadReport {
	reloaded: number;

	skipped: { sessionId: string; reason: "busy" }[];
}

export interface McpMutationResult {
	config: McpConfigListResult;

	reload: McpReloadReport;
}

export interface McpRawConfig {
	path: string;
	text: string;
}

export const MCP_TOOL_PREFIX = "mcp__";

export function parseMcpToolName(toolName: string): { server: string; tool: string } | undefined {
	if (!toolName.startsWith(MCP_TOOL_PREFIX)) return undefined;
	const rest = toolName.slice(MCP_TOOL_PREFIX.length);
	const sep = rest.indexOf("__");
	if (sep <= 0 || sep + 2 >= rest.length) return undefined;
	return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

export function groupMcpTools(toolNames: readonly string[]): Map<string, string[]> {
	const grouped = new Map<string, string[]>();
	for (const name of toolNames) {
		const parsed = parseMcpToolName(name);
		if (!parsed) continue;
		const list = grouped.get(parsed.server) ?? [];
		list.push(name);
		grouped.set(parsed.server, list);
	}
	for (const list of grouped.values()) list.sort();
	return grouped;
}
