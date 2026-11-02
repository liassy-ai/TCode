export interface McpNoticeResult {
	problems: Array<{ name: string; error?: string; needsAuth?: boolean }>;

	auth?: { name: string; url: string };

	cleared: string[];

	globalError?: string;
}

const ATTENTION_HEAD = "MCP servers need attention:";
const SIGN_IN_HEAD = "Sign in to MCP server ";

function quotedName(text: string, head: string): string | undefined {
	if (!text.startsWith(head)) return undefined;
	const rest = text.slice(head.length);
	const start = rest.indexOf('"');
	const end = rest.indexOf('"', start + 1);
	if (start !== 0 || end < 0) return undefined;
	return rest.slice(1, end);
}

export function parseMcpNotice(text: string): McpNoticeResult | undefined {
	const body = text.trim();

	if (body.startsWith(ATTENTION_HEAD)) {
		const problems: McpNoticeResult["problems"] = [];
		for (const raw of body.slice(ATTENTION_HEAD.length).split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("config:") || line.startsWith("Run /mcp")) continue;
			const sep = line.indexOf(": ");
			if (sep <= 0) continue;
			const name = line.slice(0, sep).trim();
			const state = line.slice(sep + 2).trim();
			if (state === "needs sign-in") {
				problems.push({ name, needsAuth: true, error: state });
				continue;
			}
			if (state.startsWith("failed")) {
				const message = state.slice("failed:".length).trim();
				problems.push({ name, error: message.length > 0 ? message : "failed" });
			}
		}
		return problems.length > 0 ? { problems, cleared: [] } : { problems: [], cleared: [] };
	}

	if (body.startsWith(SIGN_IN_HEAD)) {
		const name = quotedName(body, SIGN_IN_HEAD);
		const url = body
			.split("\n")
			.map((line) => line.trim())
			.find((line) => /^https?:\/\//i.test(line));
		if (name && url) return { problems: [{ name, needsAuth: true }], auth: { name, url }, cleared: [] };
		return undefined;
	}

	const signedIn = quotedName(body, "Signed in to MCP server ");
	if (signedIn) return { problems: [], cleared: [signedIn] };

	const reconnected = quotedName(body, "Reconnected to MCP server ");
	if (reconnected) return { problems: [], cleared: [reconnected] };

	if (body.startsWith("MCP failed to load:")) {
		return { problems: [], cleared: [], globalError: body.slice("MCP failed to load:".length).trim() };
	}

	return undefined;
}
