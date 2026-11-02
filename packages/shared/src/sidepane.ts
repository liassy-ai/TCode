export type SidePaneTabKind =
	| "browser"
	| "code-viewer"
	| "diff"
	| "terminal"
	| "subagent-directory"
	| "subagent-session";

export const SIDEPANE_TAB_KINDS: readonly SidePaneTabKind[] = [
	"browser",
	"code-viewer",
	"diff",
	"terminal",
	"subagent-directory",
	"subagent-session",
];

export const SIDEPANE_LAUNCHER_KINDS: readonly SidePaneTabKind[] = [
	"diff",
	"terminal",
	"browser",
	"subagent-directory",
];

export const SIDEPANE_LIVE_RESOURCE_KINDS: readonly SidePaneTabKind[] = ["browser", "terminal"];

export const SIDEPANE_SINGLETON_KINDS: readonly SidePaneTabKind[] = ["diff", "subagent-directory"];

export function isSidePaneTabKind(value: unknown): value is SidePaneTabKind {
	return typeof value === "string" && (SIDEPANE_TAB_KINDS as readonly string[]).includes(value);
}

export function isSidePaneSingletonKind(kind: SidePaneTabKind): boolean {
	return (SIDEPANE_SINGLETON_KINDS as readonly string[]).includes(kind);
}

export function isSidePaneLiveResourceKind(kind: SidePaneTabKind): boolean {
	return (SIDEPANE_LIVE_RESOURCE_KINDS as readonly string[]).includes(kind);
}

export interface SidePaneTabSnapshot {
	id: string;
	kind: SidePaneTabKind;

	title: string;

	payload: Record<string, string>;

	openedAt: number;
}

export interface SidePaneOwnerSnapshot {
	cwd: string;
	tabs: SidePaneTabSnapshot[];

	activeTabId: string | null;
}

export interface SidePaneSnapshot {
	widthPx: number;

	chatWidthPx?: number | null;

	expandedCwd: string | null;

	owners: SidePaneOwnerSnapshot[];
}

export const SIDEPANE_DEFAULT_WIDTH_PX = 420;

export const SIDEPANE_MIN_WIDTH_PX = 280;

export const SIDEPANE_WIDTH_HARD_MAX_PX = 10000;

export const SIDEPANE_MAX_OWNERS = 50;

export const SIDEPANE_EMPTY_SNAPSHOT: SidePaneSnapshot = {
	widthPx: SIDEPANE_DEFAULT_WIDTH_PX,
	chatWidthPx: null,
	expandedCwd: null,
	owners: [],
};

export const SIDEPANE_SCOPE_SESSION_KEY = "sessionId";

export function sidePaneTabId(kind: SidePaneTabKind, discriminator?: string): string {
	if (isSidePaneSingletonKind(kind)) return kind;
	return discriminator ? `${kind}:${discriminator}` : kind;
}
