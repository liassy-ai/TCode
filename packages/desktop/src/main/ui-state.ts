import { join } from "node:path";
import { createLogger, JsonStore } from "@tcode/backend";
import type {
	PermissionMode,
	SessionWorkspaceSnapshot,
	SidePaneOwnerSnapshot,
	SidePaneSnapshot,
	SidePaneTabSnapshot,
	UiState,
} from "@tcode/shared";
import {
	isSidePaneTabKind,
	SIDEPANE_DEFAULT_WIDTH_PX,
	SIDEPANE_MAX_OWNERS,
	SIDEPANE_MIN_WIDTH_PX,
	SIDEPANE_WIDTH_HARD_MAX_PX,
} from "@tcode/shared";
import { app } from "electron";

const log = createLogger("ui-state");

let uiStateSavedListener: ((patch: Partial<UiState>) => void) | null = null;
export function onUiStateSaved(cb: (patch: Partial<UiState>) => void): void {
	uiStateSavedListener = cb;
}

function uiStateFilePath(): string {
	return join(app.getPath("userData"), "ui-state.json");
}

type UiStateFileShape = Partial<UiState> & {
	currentModel?: { provider: string; modelId: string } | null;
	thinkingLevel?: string;
};

function uiStateStore(): JsonStore<UiStateFileShape | null> {
	return new JsonStore<UiStateFileShape | null>({
		path: uiStateFilePath(),
		defaultValue: () => null,
	});
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item !== "")
		: [];
}

function permissionModeMap(value: unknown): Record<string, PermissionMode> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, PermissionMode> = {};
	for (const [sessionId, mode] of Object.entries(value as Record<string, unknown>)) {
		if (sessionId === "") continue;
		if (mode === "fullAccess") out[sessionId] = mode;
	}
	return out;
}

function filePathArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const path = item.trim();
		if (path === "" || seen.has(path)) continue;
		seen.add(path);
		out.push(path);
	}
	return out;
}

function workspaceSnapshot(
	value: unknown,
	barVisible: boolean,
	railEnabled: boolean,
): SessionWorkspaceSnapshot {
	if (!barVisible && !railEnabled) return { files: [], activeFile: null };
	const raw = (value ?? {}) as Partial<SessionWorkspaceSnapshot>;
	const files = filePathArray(raw.files);
	const active = typeof raw.activeFile === "string" ? raw.activeFile.trim() : "";
	return { files, activeFile: active !== "" && files.includes(active) ? active : null };
}

const SIDEPANE_MAX_TABS_PER_OWNER = 16;

function sidePaneNumber(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

function sidePanePayload(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (key === "" || typeof raw !== "string" || raw === "") continue;
		out[key] = raw;
	}
	return out;
}

function sidePaneTabs(value: unknown): SidePaneTabSnapshot[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: SidePaneTabSnapshot[] = [];
	for (const item of value) {
		const raw = (item ?? {}) as Partial<SidePaneTabSnapshot>;
		if (typeof raw.id !== "string" || raw.id === "" || seen.has(raw.id)) continue;
		if (!isSidePaneTabKind(raw.kind)) continue;
		seen.add(raw.id);
		out.push({
			id: raw.id,
			kind: raw.kind,
			title: typeof raw.title === "string" ? raw.title : "",
			payload: sidePanePayload(raw.payload),
			openedAt: sidePaneNumber(raw.openedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
		});
		if (out.length >= SIDEPANE_MAX_TABS_PER_OWNER) break;
	}
	return out;
}

function sidePaneOwners(value: unknown): SidePaneOwnerSnapshot[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: SidePaneOwnerSnapshot[] = [];
	for (const item of value) {
		const raw = (item ?? {}) as Partial<SidePaneOwnerSnapshot>;
		if (typeof raw.cwd !== "string" || raw.cwd === "" || seen.has(raw.cwd)) continue;
		seen.add(raw.cwd);
		const tabs = sidePaneTabs(raw.tabs);
		const active = typeof raw.activeTabId === "string" ? raw.activeTabId : "";
		out.push({
			cwd: raw.cwd,
			tabs,
			activeTabId: tabs.some((tab) => tab.id === active) ? active : (tabs[0]?.id ?? null),
		});
		if (out.length >= SIDEPANE_MAX_OWNERS) break;
	}
	return out;
}

function sidePaneSnapshot(value: unknown): SidePaneSnapshot {
	const raw = (value ?? {}) as Partial<SidePaneSnapshot>;
	return {
		widthPx: sidePaneNumber(
			raw.widthPx,
			SIDEPANE_DEFAULT_WIDTH_PX,
			SIDEPANE_MIN_WIDTH_PX,
			SIDEPANE_WIDTH_HARD_MAX_PX,
		),

		chatWidthPx:
			typeof raw.chatWidthPx === "number" && Number.isFinite(raw.chatWidthPx) && raw.chatWidthPx >= 0
				? Math.round(raw.chatWidthPx)
				: null,

		expandedCwd: typeof raw.expandedCwd === "string" && raw.expandedCwd !== "" ? raw.expandedCwd : null,
		owners: sidePaneOwners(raw.owners),
	};
}

function normalize(parsed: UiStateFileShape): UiState {
	const model = parsed.lastUsedModel ?? parsed.currentModel;
	const level = parsed.lastUsedThinkingLevel ?? parsed.thinkingLevel;
	const theme =
		parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
			? parsed.theme
			: "system";
	const background = parsed.background;
	const dim =
		typeof background?.dim === "number" && background.dim >= 0 && background.dim <= 1 ? background.dim : 0.8;

	const expandedGroups = stringArray(parsed.expandedGroups);

	const barSessionsVisible =
		typeof parsed.barSessionsVisible === "boolean" ? parsed.barSessionsVisible : false;

	const sessionRailEnabled =
		typeof parsed.sessionRailEnabled === "boolean" ? parsed.sessionRailEnabled : false;
	return {
		lastUsedModel: model ? { provider: model.provider, modelId: model.modelId } : null,
		lastUsedThinkingLevel: typeof level === "string" ? level : "medium",
		theme,
		background: { image: typeof background?.image === "string" ? background.image : null, dim },
		centerOrbEnabled: typeof parsed.centerOrbEnabled === "boolean" ? parsed.centerOrbEnabled : false,

		browserControl: parsed.browserControl === true,

		pinnedSessions: stringArray(parsed.pinnedSessions),
		sessionPermissionModes: permissionModeMap(parsed.sessionPermissionModes),

		barSessionsVisible,
		sessionRailEnabled,
		sessionWorkspace: workspaceSnapshot(parsed.sessionWorkspace, barSessionsVisible, sessionRailEnabled),
		sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : false,
		expandedGroups,

		expandedGroupsTouched:
			typeof parsed.expandedGroupsTouched === "boolean"
				? parsed.expandedGroupsTouched
				: expandedGroups.length > 0,
		pinnedProjects: stringArray(parsed.pinnedProjects),

		lastCwd: typeof parsed.lastCwd === "string" && parsed.lastCwd.length > 0 ? parsed.lastCwd : null,

		sidePane: sidePaneSnapshot(parsed.sidePane),
	};
}

export async function loadUiState(): Promise<UiState | null> {
	const parsed = await uiStateStore().read();
	if (!parsed) return null;
	const model = parsed.lastUsedModel ?? parsed.currentModel;
	if (model && typeof model.provider !== "string") return null;
	if (model && typeof model.modelId !== "string") return null;
	return normalize(parsed);
}

export async function saveUiState(patch: Partial<UiState>): Promise<void> {
	try {
		await uiStateStore().update((draft) => normalize({ ...(draft ?? {}), ...patch }));
		uiStateSavedListener?.(patch);
	} catch (err) {
		log.error("ui-state save failed", err);
		throw err;
	}
}
