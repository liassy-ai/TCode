import { openBrowserTab } from "../sidepane/openers";
import { useSidePaneStore } from "../sidepane/store";

const LOCAL_SERVER_URL_RE =
	/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d{2,5}(?:[/?#][^\s"'`<>()[\]（）【】，。；：！？\u4e00-\u9fa5\p{Cc}]*)?/giu;

const FAILURE_HINT_RE =
	/EADDRINUSE|ECONNREFUSED|ECONNRESET|Connection refused|Failed to connect|address already in use/i;

export function extractLocalServerUrl(output: string): string | null {
	let found: string | null = null;
	for (const line of output.split(/\r?\n/)) {
		if (FAILURE_HINT_RE.test(line)) continue;
		const matches = line.match(LOCAL_SERVER_URL_RE);
		const last = matches && matches.length > 0 ? matches[matches.length - 1] : undefined;
		if (last) found = normalizeLocalUrl(last);
	}
	return found;
}

function normalizeLocalUrl(url: string): string {
	return url.replace(/[.,;:)\]"'`]+$/, "").replace(/\/+$/, "");
}

export function isLocalPreviewUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(parsed.hostname);
	} catch {
		return false;
	}
}

export function toolResultText(result: unknown): string {
	if (typeof result === "string") return result;
	if (!result || typeof result !== "object") return "";
	const { content, output, text } = result as { content?: unknown; output?: unknown; text?: unknown };
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const blockText = (block as { text?: unknown }).text;
			if ((block as { type?: unknown }).type === "text" && typeof blockText === "string")
				parts.push(blockText);
		}
		if (parts.length > 0) return parts.join("\n");
	}
	if (typeof output === "string") return output;
	if (typeof text === "string") return text;
	return "";
}

const candidates = new Map<string, string>();

const autoOpened = new Map<string, string>();

const touchedSessions = new Set<string>();

const MUTATING_TOOLS = new Set(["bash", "write", "edit"]);

export function noteToolActivity(sessionId: string, toolName: string): void {
	if (MUTATING_TOOLS.has(toolName)) touchedSessions.add(sessionId);
}

export function noteToolOutput(sessionId: string, output: string): void {
	const url = extractLocalServerUrl(output);
	if (url) candidates.set(sessionId, url);
}

export function handleAgentSettled(sessionId: string): void {
	const touched = touchedSessions.delete(sessionId);
	const url = candidates.get(sessionId);
	candidates.delete(sessionId);
	const owner = useSidePaneStore.getState().owners.find((entry) => entry.sessionId === sessionId);
	if (touched) {
		for (const tab of owner?.tabs ?? []) {
			if (tab.kind === "browser" && isLocalPreviewUrl(tab.payload.url ?? "")) {
				useSidePaneStore.getState().reloadTab(tab.id);
			}
		}
	}
	if (!url) return;
	if (autoOpened.get(sessionId) === url) return;
	if (owner?.tabs.some((tab) => tab.kind === "browser" && tab.payload.url === url)) return;
	autoOpened.set(sessionId, url);
	openBrowserTab(url);
}
