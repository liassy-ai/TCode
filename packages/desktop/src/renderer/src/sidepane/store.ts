import type { SidePaneSnapshot, SidePaneTabKind, SidePaneTabSnapshot } from "@tcode/shared";
import {
	SIDEPANE_DEFAULT_WIDTH_PX,
	SIDEPANE_EMPTY_SNAPSHOT,
	SIDEPANE_MAX_OWNERS,
	SIDEPANE_MIN_WIDTH_PX,
	SIDEPANE_SCOPE_SESSION_KEY,
	SIDEPANE_WIDTH_HARD_MAX_PX,
	sidePaneTabId,
} from "@tcode/shared";
import { create } from "zustand";
import { getPi } from "../api";

const EMPTY_TABS: readonly SidePaneTabSnapshot[] = [];

export interface SidePaneOwner {
	sessionId: string;

	cwd: string;
	tabs: SidePaneTabSnapshot[];

	activeTabId: string | null;

	expanded: boolean;
}

export interface OpenSidePaneTabInput {
	kind: SidePaneTabKind;

	discriminator?: string;
	title: string;
	payload?: Record<string, string>;

	sessionId?: string;

	ownerSessionId?: string;

	activate?: boolean;
}

interface SidePaneStore {
	widthPx: number;

	chatWidthPx: number | null;

	opening: boolean;

	owners: SidePaneOwner[];

	cwd: string | null;
	sessionId: string | null;

	resizing: boolean;

	autoShrunkFromPx: number | null;

	hydrate: (snapshot: SidePaneSnapshot | null | undefined) => void;
	setOwner: (cwd: string | null, sessionId: string | null) => void;

	ensureOwner: (cwd: string | null, sessionId: string) => void;

	floating: boolean;

	setFloating: (floating: boolean) => void;
	setResizing: (resizing: boolean) => void;

	previewWidth: (widthPx: number) => void;

	commitWidth: (widthPx: number, chatWidthPx?: number | null) => void;

	setChatWidthPx: (chatWidthPx: number | null) => void;
	setOpening: (opening: boolean) => void;

	setAutoShrunkFromPx: (widthPx: number | null) => void;

	toggleExpanded: () => void;

	collapse: () => void;

	adoptDraftOwner: (draftKey: string, sessionId: string) => void;
	openTab: (input: OpenSidePaneTabInput) => string;
	activateTab: (tabId: string) => void;

	focusBrowserTab: (tabId: string) => void;

	setTabTitle: (tabId: string, title: string) => void;
	closeTab: (tabId: string) => void;
	closeOtherTabs: (tabId: string) => void;
	closeAllTabs: () => void;
	reorderTabs: (activeTabId: string, overTabId: string) => void;

	reloadTicks: Record<string, number>;

	reloadTab: (tabId: string) => void;
}

function clampWidth(widthPx: number): number {
	if (!Number.isFinite(widthPx)) return SIDEPANE_DEFAULT_WIDTH_PX;
	return Math.min(SIDEPANE_WIDTH_HARD_MAX_PX, Math.max(SIDEPANE_MIN_WIDTH_PX, Math.round(widthPx)));
}

function clampChatWidth(chatWidthPx: number | null): number | null {
	if (chatWidthPx === null || !Number.isFinite(chatWidthPx)) return null;
	return Math.max(0, Math.round(chatWidthPx));
}

function ownerOf(state: SidePaneStore): SidePaneOwner | null {
	const sessionId = state.sessionId;
	if (!sessionId) return null;
	return state.owners.find((owner) => owner.sessionId === sessionId) ?? null;
}

export function isDockExpanded(state: SidePaneStore): boolean {
	return ownerOf(state)?.expanded ?? false;
}

export function dockTakesSlack(state: SidePaneStore): boolean {
	return (
		isDockExpanded(state) &&
		!state.floating &&
		!state.resizing &&
		!state.opening &&
		state.chatWidthPx !== null
	);
}

function withOwnerMovedToEnd(owners: SidePaneOwner[], sessionId: string, cwd: string): SidePaneOwner[] {
	const existing = owners.find((owner) => owner.sessionId === sessionId);
	const rest = owners.filter((owner) => owner.sessionId !== sessionId);
	const owner: SidePaneOwner = existing
		? { ...existing, cwd }
		: { sessionId, cwd, tabs: [], activeTabId: null, expanded: false };
	const next = [...rest, owner];
	return next.length > SIDEPANE_MAX_OWNERS ? next.slice(next.length - SIDEPANE_MAX_OWNERS) : next;
}

function mapOwners(
	owners: SidePaneOwner[],
	sessionId: string,
	transform: (owner: SidePaneOwner) => SidePaneOwner,
): SidePaneOwner[] {
	return owners.map((owner) => (owner.sessionId === sessionId ? transform(owner) : owner));
}

let pendingWidth: number | null = null;
let pendingChatWidth: number | null = null;
let flushing = false;

function schedulePersist(state: SidePaneStore): void {
	pendingWidth = state.widthPx;
	pendingChatWidth = state.chatWidthPx;
	if (flushing) return;
	flushing = true;
	void (async () => {
		try {
			while (pendingWidth !== null) {
				const widthPx = pendingWidth;
				const chatWidthPx = pendingChatWidth;
				pendingWidth = null;
				try {
					await getPi().saveUiState({
						state: { sidePane: { ...SIDEPANE_EMPTY_SNAPSHOT, widthPx, chatWidthPx } },
					});
				} catch (error) {
					console.error("右侧栏持久化失败", error);
				}
			}
		} finally {
			flushing = false;
		}
	})();
}

export const useSidePaneStore = create<SidePaneStore>((set, get) => ({
	widthPx: SIDEPANE_DEFAULT_WIDTH_PX,
	chatWidthPx: null,
	opening: false,
	owners: [],
	cwd: null,
	sessionId: null,
	resizing: false,
	floating: false,
	autoShrunkFromPx: null,
	reloadTicks: {},

	reloadTab: (tabId) => {
		set((state) => ({ reloadTicks: { ...state.reloadTicks, [tabId]: (state.reloadTicks[tabId] ?? 0) + 1 } }));
	},

	hydrate: (snapshot) => {
		if (!snapshot) return;

		set({ widthPx: clampWidth(snapshot.widthPx), chatWidthPx: clampChatWidth(snapshot.chatWidthPx ?? null) });
	},

	setOwner: (cwd, sessionId) => {
		const state = get();
		if (state.cwd === cwd && state.sessionId === sessionId) return;
		const owners = sessionId ? withOwnerMovedToEnd(state.owners, sessionId, cwd ?? "") : state.owners;
		set({ cwd, sessionId, owners });
	},

	ensureOwner: (cwd, sessionId) => {
		const state = get();
		if (state.owners.some((owner) => owner.sessionId === sessionId)) return;
		set({ owners: withOwnerMovedToEnd(state.owners, sessionId, cwd ?? "") });
	},

	setFloating: (floating) => {
		if (get().floating === floating) return;
		set({ floating });
	},

	setResizing: (resizing) => set({ resizing }),

	previewWidth: (widthPx) => set({ widthPx: clampWidth(widthPx) }),

	setOpening: (opening) => set({ opening }),

	commitWidth: (widthPx, chatWidthPx) => {
		const next = clampWidth(widthPx);

		const chat = chatWidthPx === undefined ? get().chatWidthPx : clampChatWidth(chatWidthPx);
		set({ widthPx: next, autoShrunkFromPx: null, chatWidthPx: chat });
		schedulePersist(get());
	},

	setChatWidthPx: (chatWidthPx) => {
		const next = clampChatWidth(chatWidthPx);
		if (get().chatWidthPx === next) return;
		set({ chatWidthPx: next });
		schedulePersist(get());
	},

	setAutoShrunkFromPx: (widthPx) => {
		if (get().autoShrunkFromPx === widthPx) return;
		set({ autoShrunkFromPx: widthPx });
	},

	toggleExpanded: () => {
		const state = get();
		const owner = ownerOf(state);

		if (!owner) return;
		const expanded = !owner.expanded;
		const flipped = mapOwners(state.owners, owner.sessionId, (entry) => ({ ...entry, expanded }));

		const owners = expanded ? withOwnerMovedToEnd(flipped, owner.sessionId, owner.cwd) : flipped;
		set({ owners });
	},

	collapse: () => {
		const state = get();
		const owner = ownerOf(state);
		if (!owner?.expanded) return;
		set({ owners: mapOwners(state.owners, owner.sessionId, (entry) => ({ ...entry, expanded: false })) });
	},

	adoptDraftOwner: (draftKey, sessionId) => {
		const state = get();
		const draft = state.owners.find((owner) => owner.sessionId === draftKey);
		if (!draft) return;

		const rest = state.owners.filter(
			(owner) => owner.sessionId !== draftKey && owner.sessionId !== sessionId,
		);
		set({ owners: [...rest, { ...draft, sessionId }] });
	},

	openTab: (input) => {
		const state = get();

		const owner = input.ownerSessionId
			? (state.owners.find((entry) => entry.sessionId === input.ownerSessionId) ?? null)
			: ownerOf(state);
		const id = sidePaneTabId(input.kind, input.discriminator);
		if (!owner) return id;

		const payload: Record<string, string> = { ...(input.payload ?? {}) };
		if (input.sessionId) payload[SIDEPANE_SCOPE_SESSION_KEY] = input.sessionId;

		const existing = owner.tabs.find((tab) => tab.id === id);
		const tabs = existing
			? owner.tabs
			: [
					...owner.tabs,
					{
						id,
						kind: input.kind,
						title: input.title,
						payload,
						openedAt: Date.now(),
					} satisfies SidePaneTabSnapshot,
				];

		const owners = mapOwners(state.owners, owner.sessionId, (entry) => ({
			...entry,
			tabs,

			activeTabId: input.activate === false && existing ? entry.activeTabId : id,

			expanded: true,
		}));
		set({ owners });
		return id;
	},

	activateTab: (tabId) => {
		const state = get();
		const owner = ownerOf(state);
		if (!owner) return;
		set({
			owners: mapOwners(state.owners, owner.sessionId, (entry) => ({ ...entry, activeTabId: tabId })),
		});
	},

	focusBrowserTab: (tabId) => {
		const state = get();
		const owner = ownerOf(state);
		if (!owner) return;
		set({
			owners: mapOwners(state.owners, owner.sessionId, (entry) => ({
				...entry,
				activeTabId: tabId,
				expanded: true,
			})),
		});
	},

	setTabTitle: (tabId, title) => {
		const state = get();
		let changed = false;
		const owners = state.owners.map((owner) => {
			if (!owner.tabs.some((tab) => tab.id === tabId && tab.title !== title)) return owner;
			changed = true;
			return { ...owner, tabs: owner.tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)) };
		});
		if (changed) set({ owners });
	},

	closeTab: (tabId) => {
		const state = get();
		const owner = ownerOf(state);
		if (!owner) return;
		set({
			owners: mapOwners(state.owners, owner.sessionId, (entry) => {
				const index = entry.tabs.findIndex((tab) => tab.id === tabId);
				const tabs = entry.tabs.filter((tab) => tab.id !== tabId);

				const activeTabId =
					entry.activeTabId === tabId ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null) : entry.activeTabId;
				return { ...entry, tabs, activeTabId };
			}),
		});
	},

	closeOtherTabs: (tabId) => {
		const state = get();
		const owner = ownerOf(state);
		if (!owner) return;
		set({
			owners: mapOwners(state.owners, owner.sessionId, (entry) => ({
				...entry,
				tabs: entry.tabs.filter((tab) => tab.id === tabId),
				activeTabId: tabId,
			})),
		});
	},

	closeAllTabs: () => {
		const state = get();
		const owner = ownerOf(state);
		if (!owner) return;
		set({
			owners: mapOwners(state.owners, owner.sessionId, (entry) => ({
				...entry,
				tabs: [],
				activeTabId: null,
			})),
		});
	},

	reorderTabs: (activeTabId, overTabId) => {
		const state = get();
		const owner = ownerOf(state);
		if (!owner || activeTabId === overTabId) return;
		set({
			owners: mapOwners(state.owners, owner.sessionId, (entry) => {
				const from = entry.tabs.findIndex((tab) => tab.id === activeTabId);
				const to = entry.tabs.findIndex((tab) => tab.id === overTabId);
				if (from < 0 || to < 0) return entry;
				const tabs = [...entry.tabs];
				const [moved] = tabs.splice(from, 1);
				if (moved) tabs.splice(to, 0, moved);
				return { ...entry, tabs };
			}),
		});
	},
}));

export function selectOwnerTabs(state: SidePaneStore): readonly SidePaneTabSnapshot[] {
	const owner = ownerOf(state);
	return owner?.tabs ?? EMPTY_TABS;
}

export function selectActiveTabId(state: SidePaneStore): string | null {
	return ownerOf(state)?.activeTabId ?? null;
}

export function isTabVisibleInSession(tab: SidePaneTabSnapshot, sessionId: string | null): boolean {
	const scope = tab.payload[SIDEPANE_SCOPE_SESSION_KEY];
	if (!scope) return true;
	return scope === sessionId;
}
