import type { PermissionMode, SidebarBackground, UiState } from "@tcode/shared";
import { create } from "zustand";
import { getPi } from "../api";
import { SIDEBAR_DEFAULT_WIDTH_PX, setSidebarWidthPx } from "../lib/layout-metrics";
import { toggleInList } from "../lib/toggle-in-list";
import { isDockExpanded, useSidePaneStore } from "../sidepane/store";
import { useChatLayoutStore } from "./chat-layout";

interface UiPreferencesStore {
	browserControl: boolean;

	taskNotifyEnabled: boolean;

	pinnedSessions: string[];

	sessionPermissionModes: Record<string, PermissionMode>;

	barSessionsVisible: boolean;

	sessionRailEnabled: boolean;

	sidebarCollapsed: boolean;

	sidebarWidth: number;

	sidebarWidthPreview: number | null;

	autoCollapsed: boolean;

	sidebarFloating: boolean;

	expandedGroups: string[];

	expandedGroupsTouched: boolean;

	pinnedProjects: string[];

	lastCwd: string | null;

	sidebarBackground: SidebarBackground;

	init: () => Promise<void>;

	setBrowserControl: (enabled: boolean) => void;

	setTaskNotifyEnabled: (enabled: boolean) => void;

	togglePin: (sessionId: string) => void;
	setBarSessionsVisible: (visible: boolean) => void;

	setSessionRailEnabled: (enabled: boolean) => void;

	toggleSidebarCollapsed: () => void;

	setSidebarBackground: (value: SidebarBackground) => void;

	setSidebarWidth: (width: number, persist?: boolean) => void;

	setSidebarWidthPreview: (width: number | null) => void;

	setAutoCollapsed: (collapsed: boolean) => void;

	setSidebarFloating: (floating: boolean) => void;

	setExpandedGroups: (groups: string[]) => void;

	toggleProjectPin: (cwd: string) => void;

	unpin: (sessionId: string) => void;

	rememberPermissionMode: (sessionId: string, mode: PermissionMode) => void;

	forgetPermissionMode: (sessionId: string) => void;

	applyExternalPatch: (patch: Partial<UiState>) => void;

	setLastCwd: (cwd: string | null) => void;
}

function normalizeSidebarBackground(value: unknown): SidebarBackground {
	const raw = String(value);
	if (raw === "translucent") return "translucent";
	if (raw === "deep" || raw === "white") return "deep";
	return "soft";
}

function applySidebarBackground(value: SidebarBackground): void {
	document.documentElement.dataset.sidebarBg = value;
}

function persistPatch(patch: Partial<UiState>): void {
	getPi()
		.saveUiState({ state: patch })
		.catch((error) => console.error("ui-state 持久化失败", error));
}

export const useUiPreferencesStore = create<UiPreferencesStore>((set, get) => ({
	browserControl: true,
	taskNotifyEnabled: true,
	pinnedSessions: [],
	sessionPermissionModes: {},
	barSessionsVisible: false,
	sessionRailEnabled: false,
	sidebarCollapsed: false,
	sidebarWidth: SIDEBAR_DEFAULT_WIDTH_PX,
	sidebarWidthPreview: null,
	autoCollapsed: false,
	sidebarFloating: false,

	expandedGroups: [],
	expandedGroupsTouched: false,

	pinnedProjects: [],
	lastCwd: null,
	sidebarBackground: "soft",

	init: async () => {
		const saved = await getPi()
			.loadUiState()
			.catch(() => null);
		set({
			browserControl: saved?.browserControl !== false,
			taskNotifyEnabled: saved?.taskNotifyEnabled !== false,
			pinnedSessions: saved?.pinnedSessions ?? [],
			sessionPermissionModes: saved?.sessionPermissionModes ?? {},
			barSessionsVisible: saved?.barSessionsVisible ?? false,
			sessionRailEnabled: saved?.sessionRailEnabled ?? false,
			sidebarCollapsed: saved?.sidebarCollapsed ?? false,
			sidebarWidth: setSidebarWidthPx(saved?.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH_PX),
			expandedGroups: saved?.expandedGroups ?? [],
			expandedGroupsTouched: saved?.expandedGroupsTouched ?? false,
			pinnedProjects: saved?.pinnedProjects ?? [],
			lastCwd: saved?.lastCwd ?? null,
			sidebarBackground: normalizeSidebarBackground(saved?.sidebarBackground),
		});

		applySidebarBackground(normalizeSidebarBackground(saved?.sidebarBackground));

		useSidePaneStore.getState().hydrate(saved?.sidePane);
	},

	applyExternalPatch: (patch) => {
		const next: Partial<ReturnType<typeof get>> = {};
		if (patch.browserControl !== undefined) next.browserControl = patch.browserControl !== false;
		if (patch.taskNotifyEnabled !== undefined) next.taskNotifyEnabled = patch.taskNotifyEnabled !== false;
		if (patch.pinnedSessions !== undefined) next.pinnedSessions = patch.pinnedSessions;
		if (patch.sessionPermissionModes !== undefined)
			next.sessionPermissionModes = patch.sessionPermissionModes;
		if (patch.barSessionsVisible !== undefined) next.barSessionsVisible = patch.barSessionsVisible === true;
		if (patch.sessionRailEnabled !== undefined) next.sessionRailEnabled = patch.sessionRailEnabled === true;
		if (patch.sidebarCollapsed !== undefined) next.sidebarCollapsed = patch.sidebarCollapsed === true;
		if (patch.sidebarWidth !== undefined) next.sidebarWidth = setSidebarWidthPx(patch.sidebarWidth);
		if (patch.expandedGroups !== undefined) next.expandedGroups = patch.expandedGroups;
		if (patch.expandedGroupsTouched !== undefined)
			next.expandedGroupsTouched = patch.expandedGroupsTouched === true;
		if (patch.pinnedProjects !== undefined) next.pinnedProjects = patch.pinnedProjects;
		if (patch.lastCwd !== undefined) next.lastCwd = patch.lastCwd ?? null;
		if (patch.sidebarBackground !== undefined) {
			const sidebarBackground = normalizeSidebarBackground(patch.sidebarBackground);
			next.sidebarBackground = sidebarBackground;
			applySidebarBackground(sidebarBackground);
		}
		if (Object.keys(next).length > 0) set(next);
	},

	setBrowserControl: (enabled) => {
		set({ browserControl: enabled });
		persistPatch({ browserControl: enabled });
	},

	setTaskNotifyEnabled: (enabled) => {
		set({ taskNotifyEnabled: enabled });
		persistPatch({ taskNotifyEnabled: enabled });
	},

	setBarSessionsVisible: (visible) => {
		set({ barSessionsVisible: visible });
		persistPatch({ barSessionsVisible: visible });
	},

	setSessionRailEnabled: (enabled) => {
		set({ sessionRailEnabled: enabled });
		persistPatch({ sessionRailEnabled: enabled });
	},

	setSidebarBackground: (value) => {
		set({ sidebarBackground: value });
		applySidebarBackground(value);
		persistPatch({ sidebarBackground: value });
	},

	setLastCwd: (cwd) => {
		if (get().lastCwd === cwd) return;
		set({ lastCwd: cwd });
		persistPatch({ lastCwd: cwd });
	},

	toggleSidebarCollapsed: () => {
		const hidden = get().sidebarCollapsed || get().autoCollapsed;
		const sidebarCollapsed = !hidden;
		if (sidebarCollapsed) {
			set({ sidebarCollapsed: true, autoCollapsed: false, sidebarFloating: get().sidebarFloating });
			persistPatch({ sidebarCollapsed: true });
			return;
		}

		const floorPx = useChatLayoutStore.getState().floorPx;
		const sidePane = useSidePaneStore.getState();
		const dockPx = isDockExpanded(sidePane) ? sidePane.widthPx : 0;
		const floating = floorPx > 0 && window.innerWidth - get().sidebarWidth - dockPx < floorPx;

		if (floating && sidePane.floating) useSidePaneStore.getState().collapse();
		set({ sidebarCollapsed: false, autoCollapsed: false, sidebarFloating: floating });
		persistPatch({ sidebarCollapsed: false });
	},

	setSidebarWidthPreview: (width) => {
		const next = width === null ? null : setSidebarWidthPx(width);
		if (next !== get().sidebarWidthPreview) set({ sidebarWidthPreview: next });
	},

	setSidebarWidth: (width, persist = true) => {
		const next = setSidebarWidthPx(width);
		if (next !== get().sidebarWidth) set({ sidebarWidth: next });
		if (persist) persistPatch({ sidebarWidth: next });
	},

	setAutoCollapsed: (collapsed) => {
		if (get().autoCollapsed === collapsed) return;

		set({ autoCollapsed: collapsed });
	},

	setSidebarFloating: (floating) => {
		if (get().sidebarFloating === floating) return;

		set({ sidebarFloating: floating });
	},

	setExpandedGroups: (groups) => {
		set({ expandedGroups: groups, expandedGroupsTouched: true });
		persistPatch({ expandedGroups: groups, expandedGroupsTouched: true });
	},

	togglePin: (sessionId) => {
		const next = toggleInList(get().pinnedSessions, sessionId);
		set({ pinnedSessions: next });
		persistPatch({ pinnedSessions: next });
	},

	toggleProjectPin: (cwd) => {
		const next = toggleInList(get().pinnedProjects, cwd);
		set({ pinnedProjects: next });
		persistPatch({ pinnedProjects: next });
	},

	unpin: (sessionId) => {
		const current = get().pinnedSessions;
		if (!current.includes(sessionId)) return;
		const next = current.filter((id) => id !== sessionId);
		set({ pinnedSessions: next });
		persistPatch({ pinnedSessions: next });
	},

	rememberPermissionMode: (sessionId, mode) => {
		const current = get().sessionPermissionModes;
		if (mode === "default") {
			if (!(sessionId in current)) return;
			const next = { ...current };
			delete next[sessionId];
			set({ sessionPermissionModes: next });
			persistPatch({ sessionPermissionModes: next });
			return;
		}
		if (current[sessionId] === mode) return;
		const next = { ...current, [sessionId]: mode };
		set({ sessionPermissionModes: next });
		persistPatch({ sessionPermissionModes: next });
	},

	forgetPermissionMode: (sessionId) => {
		const current = get().sessionPermissionModes;
		if (!(sessionId in current)) return;
		const next = { ...current };
		delete next[sessionId];
		set({ sessionPermissionModes: next });
		persistPatch({ sessionPermissionModes: next });
	},
}));

export const selectSidebarHidden = (s: { sidebarCollapsed: boolean; autoCollapsed: boolean }): boolean =>
	s.sidebarCollapsed || s.autoCollapsed;
