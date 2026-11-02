import type { SidePaneTabKind } from "@tcode/shared";
import type { Translate } from "../i18n";
import { randomUid } from "../lib/uid";
import { useSidePaneStore } from "./store";

export interface SidePaneOpenRequest {
	discriminator?: string;
	title: string;
	payload?: Record<string, string>;
}

export type SidePaneOpener = (ctx: {
	kind: SidePaneTabKind;
	cwd: string;
	sessionId: string | null;
	t: Translate;
}) => SidePaneOpenRequest;

export const SIDEPANE_OPENERS: Partial<Record<SidePaneTabKind, SidePaneOpener>> = {
	diff: () => ({ title: "" }),

	terminal: () => ({ discriminator: randomUid(), title: "" }),

	browser: () => ({ discriminator: randomUid(), title: "" }),

	"subagent-directory": () => ({ title: "" }),
};

function basename(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

export function openCodeViewerTab(path: string): void {
	useSidePaneStore.getState().openTab({
		kind: "code-viewer",
		discriminator: path,
		title: basename(path),
		payload: { path },
	});
}

export function openDiffTab(): void {
	useSidePaneStore.getState().openTab({ kind: "diff", title: "" });
}

export function openBrowserTab(url: string, ownerSessionId?: string): string {
	const key = url.replace(/\/+$/, "") || url;
	const owner = ownerSessionId ?? useSidePaneStore.getState().sessionId ?? "";
	return useSidePaneStore.getState().openTab({
		kind: "browser",
		discriminator: owner ? `${owner}\u0000${key}` : key,
		title: url.replace(/^https?:\/\//, ""),
		payload: { url },
		ownerSessionId,
	});
}

export function openSubagentSessionTab(input: {
	file: string;
	agent: string;
	task: string;
	sessionId: string | null;
}): void {
	useSidePaneStore.getState().openTab({
		kind: "subagent-session",
		discriminator: input.file,
		title: subagentSessionTabTitle(input.agent, input.task),
		payload: { file: input.file },
		sessionId: input.sessionId ?? undefined,
	});
}

function subagentSessionTabTitle(agent: string, task: string): string {
	const name = agent.charAt(0).toUpperCase() + agent.slice(1);
	const firstLine = task.split("\n")[0]?.trim() ?? "";
	return firstLine ? `${name} · ${firstLine.slice(0, 20).trim()}` : name;
}
