import type { SessionMeta, SessionWorkspaceSnapshot } from "@tcode/shared";
import { create } from "zustand";
import { getPi } from "../api";
import { isPrimaryNavigationSession } from "../lib/session-visibility";
import { useUiPreferencesStore } from "./ui-preferences";

export interface WorkspaceMember {
	file: string;

	sessionId: string;
}

const EMPTY_SNAPSHOT: SessionWorkspaceSnapshot = { files: [], activeFile: null };

export function workspaceFileKey(file: string | null | undefined): string | null {
	if (typeof file !== "string") return null;
	const trimmed = file.trim();
	return trimmed === "" ? null : trimmed;
}

export function memberIndexOf(members: readonly WorkspaceMember[], key: string | null | undefined): number {
	const file = workspaceFileKey(key);
	if (file === null) return -1;
	const byFile = members.findIndex((m) => m.file === file);
	if (byFile >= 0) return byFile;
	return members.findIndex((m) => m.sessionId === file);
}

export function resolveMember(
	members: readonly WorkspaceMember[],
	key: string | null | undefined,
): WorkspaceMember | null {
	const index = memberIndexOf(members, key);
	return index < 0 ? null : (members[index] ?? null);
}

export function insertMember(
	members: readonly WorkspaceMember[],
	member: WorkspaceMember,
	anchorFile: string | null,
): readonly WorkspaceMember[] {
	if (memberIndexOf(members, member.file) >= 0 || memberIndexOf(members, member.sessionId) >= 0) {
		return members;
	}
	const at = memberIndexOf(members, anchorFile);
	if (at < 0) return [...members, member];
	return [...members.slice(0, at + 1), member, ...members.slice(at + 1)];
}

export function nextActiveFile(
	members: readonly WorkspaceMember[],
	removedFile: string | null | undefined,
): string | null {
	const index = memberIndexOf(members, removedFile);
	if (index < 0) return null;
	return (members[index + 1] ?? members[index - 1])?.file ?? null;
}

export function moveMember(
	members: readonly WorkspaceMember[],
	fromKey: string | null | undefined,
	toKey: string | null | undefined,
): readonly WorkspaceMember[] {
	const from = memberIndexOf(members, fromKey);
	const to = memberIndexOf(members, toKey);
	if (from < 0 || to < 0 || from === to) return members;
	const next = [...members];
	const [moved] = next.splice(from, 1);
	if (!moved) return members;
	next.splice(to, 0, moved);
	return next;
}

export function pruneMembers(
	members: readonly WorkspaceMember[],
	isAlive: (member: WorkspaceMember) => boolean,
): readonly WorkspaceMember[] {
	const next = members.filter(isAlive);
	return next.length === members.length ? members : next;
}

export function workspaceSnapshotOf(
	members: readonly WorkspaceMember[],
	activeFile: string | null,
): SessionWorkspaceSnapshot {
	const files = members.map((m) => m.file);
	return { files, activeFile: activeFile !== null && files.includes(activeFile) ? activeFile : null };
}

export function normalizeMembers(value: unknown): WorkspaceMember[] {
	if (!Array.isArray(value)) return [];
	const files = new Set<string>();
	const ids = new Set<string>();
	const out: WorkspaceMember[] = [];
	for (const item of value) {
		const candidate = item as Partial<WorkspaceMember> | null;
		const file = workspaceFileKey(candidate?.file);
		const sessionId = typeof candidate?.sessionId === "string" ? candidate.sessionId.trim() : "";

		if (file === null || sessionId === "" || files.has(file) || ids.has(sessionId)) continue;
		files.add(file);
		ids.add(sessionId);
		out.push({ file, sessionId });
	}
	return out;
}

export function resolveWorkspaceSessions(
	members: readonly WorkspaceMember[],
	tabs: readonly SessionMeta[],
	history: readonly SessionMeta[],
): SessionMeta[] {
	const byId = new Map<string, SessionMeta>();
	for (const s of history) byId.set(s.sessionId, s);
	for (const s of tabs) byId.set(s.sessionId, s);
	const seen = new Set<string>();
	const out: SessionMeta[] = [];
	for (const member of members) {
		if (seen.has(member.sessionId)) continue;
		seen.add(member.sessionId);
		const meta = byId.get(member.sessionId) ?? history.find((s) => s.sessionFile === member.file);
		if (meta && isPrimaryNavigationSession(meta)) out.push(meta);
	}
	return out;
}

export function resolveActiveSessionMeta(
	activeSessionId: string | null,
	tabs: readonly SessionMeta[],
	history: readonly SessionMeta[],
): SessionMeta | null {
	if (!activeSessionId) return null;
	const meta =
		tabs.find((s) => s.sessionId === activeSessionId) ??
		history.find((s) => s.sessionId === activeSessionId) ??
		null;
	return meta && isPrimaryNavigationSession(meta) ? meta : null;
}

export function resolveMembersByFile(
	files: readonly string[],
	history: readonly SessionMeta[],
): WorkspaceMember[] {
	const byFile = new Map<string, SessionMeta>();
	for (const s of history) if (s.sessionFile) byFile.set(s.sessionFile, s);
	const seen = new Set<string>();
	const out: WorkspaceMember[] = [];
	for (const file of files) {
		const meta = byFile.get(file);
		if (!meta || seen.has(meta.sessionId) || !isPrimaryNavigationSession(meta)) continue;
		seen.add(meta.sessionId);
		out.push({ file, sessionId: meta.sessionId });
	}
	return out;
}

export function isWorkspaceRecording(): boolean {
	const prefs = useUiPreferencesStore.getState();
	return prefs.barSessionsVisible || prefs.sessionRailEnabled;
}

let pendingSnapshot: SessionWorkspaceSnapshot | null = null;
let flushing = false;

function schedulePersist(snapshot: SessionWorkspaceSnapshot): void {
	pendingSnapshot = snapshot;
	if (flushing) return;
	flushing = true;
	void (async () => {
		try {
			while (pendingSnapshot) {
				const current = pendingSnapshot;
				pendingSnapshot = null;
				try {
					await getPi().saveUiState({ state: { sessionWorkspace: current } });
				} catch (error) {
					console.error("工作区持久化失败", error);
				}
			}
		} finally {
			flushing = false;
		}
	})();
}

interface SessionWorkspaceStore {
	members: readonly WorkspaceMember[];

	activeFile: string | null;

	recentFile: string | null;

	epoch: number;

	anchorFile: () => string | null;

	addMember: (
		input: { file?: string | null; sessionId?: string | null },
		opts?: { anchorFile?: string | null; activate?: boolean },
	) => boolean;

	removeMember: (key: string) => {
		removed: WorkspaceMember;
		wasActive: boolean;
		next: WorkspaceMember | null;
	} | null;

	setActive: (key: string | null) => void;

	moveMember: (fromKey: string, toKey: string) => void;

	replaceAll: (members: unknown, activeFile: string | null) => void;

	hydrateFromSnapshot: (members: unknown, activeFile: string | null) => void;

	prune: (isAlive: (member: WorkspaceMember) => boolean) => void;

	clear: () => void;
}

export const useSessionWorkspaceStore = create<SessionWorkspaceStore>((set, get) => ({
	members: [],
	activeFile: null,
	recentFile: null,
	epoch: 0,

	anchorFile: () => get().activeFile ?? get().recentFile,

	addMember: (input, opts) => {
		if (!isWorkspaceRecording()) return false;
		const file = workspaceFileKey(input.file);
		const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";

		if (file === null || sessionId === "") return false;
		const activate = opts?.activate !== false;

		const { members, activeFile, recentFile } = get();

		const byFile = memberIndexOf(members, file);
		const existing = byFile >= 0 ? byFile : memberIndexOf(members, sessionId);
		if (existing >= 0) {
			const member = members[existing];
			if (!member || !activate || member.file === activeFile) return true;
			set({ activeFile: member.file, recentFile: member.file });
			schedulePersist(workspaceSnapshotOf(members, member.file));
			return true;
		}

		const anchor = opts && "anchorFile" in opts ? (opts.anchorFile ?? null) : (activeFile ?? recentFile);
		const next = insertMember(members, { file, sessionId }, anchor);
		const nextActive = activate ? file : activeFile;

		set({ members: next, activeFile: nextActive, recentFile: activate ? file : recentFile });
		schedulePersist(workspaceSnapshotOf(next, nextActive));
		return true;
	},

	removeMember: (key) => {
		const { members, activeFile, recentFile } = get();
		const target = resolveMember(members, key);
		if (!target) return null;
		const wasActive = activeFile === target.file;

		const fallback = nextActiveFile(members, target.file);
		const next = members.filter((m) => m.file !== target.file);
		const nextActive = wasActive ? fallback : activeFile;

		const nextRecent = recentFile === target.file ? fallback : recentFile;
		set({ members: next, activeFile: nextActive, recentFile: nextRecent });
		schedulePersist(workspaceSnapshotOf(next, nextActive));

		const successor = wasActive ? (next.find((m) => m.file === nextActive) ?? null) : null;
		return { removed: target, wasActive, next: successor };
	},

	setActive: (key) => {
		const { members, activeFile } = get();
		if (key === null) {
			if (activeFile === null) return;
			set({ activeFile: null });
			schedulePersist(workspaceSnapshotOf(members, null));
			return;
		}
		const target = resolveMember(members, key);
		if (!target || target.file === activeFile) return;

		set({ activeFile: target.file, recentFile: target.file });
		schedulePersist(workspaceSnapshotOf(members, target.file));
	},

	moveMember: (fromKey, toKey) => {
		const { members, activeFile } = get();
		const next = moveMember(members, fromKey, toKey);
		if (next === members) return;
		set({ members: next });
		schedulePersist(workspaceSnapshotOf(next, activeFile));
	},

	replaceAll: (members, activeFile) => {
		const next = normalizeMembers(members);
		const key = workspaceFileKey(activeFile);
		const nextActive = key !== null && next.some((m) => m.file === key) ? key : null;
		set({ members: next, activeFile: nextActive, recentFile: nextActive });
		schedulePersist(workspaceSnapshotOf(next, nextActive));
	},

	hydrateFromSnapshot: (members, activeFile) => {
		const saved = normalizeMembers(members);
		const { members: current, activeFile: currentActive } = get();

		const savedFiles = new Set(saved.map((m) => m.file));
		const savedIds = new Set(saved.map((m) => m.sessionId));
		const added = current.filter((m) => !savedFiles.has(m.file) && !savedIds.has(m.sessionId));
		const merged = [...saved, ...added];
		const key = workspaceFileKey(activeFile);

		const nextActive =
			currentActive !== null && merged.some((m) => m.file === currentActive)
				? currentActive
				: key !== null && merged.some((m) => m.file === key)
					? key
					: null;

		set({ members: merged, activeFile: nextActive, recentFile: nextActive ?? get().recentFile });
		schedulePersist(workspaceSnapshotOf(merged, nextActive));
	},

	prune: (isAlive) => {
		const { members, activeFile, recentFile } = get();
		const next = pruneMembers(members, isAlive);
		if (next === members) return;
		const nextActive = next.some((m) => m.file === activeFile) ? activeFile : null;
		const nextRecent = recentFile !== null && next.some((m) => m.file === recentFile) ? recentFile : null;
		set({ members: next, activeFile: nextActive, recentFile: nextRecent });
		schedulePersist(workspaceSnapshotOf(next, nextActive));
	},

	clear: () => {
		const { members, activeFile, epoch } = get();
		if (members.length === 0 && activeFile === null) {
			set({ epoch: epoch + 1 });
			return;
		}
		set({ members: [], activeFile: null, recentFile: null, epoch: epoch + 1 });
		schedulePersist(EMPTY_SNAPSHOT);
	},
}));

useUiPreferencesStore.subscribe((state, prev) => {
	if (
		state.barSessionsVisible === prev.barSessionsVisible &&
		state.sessionRailEnabled === prev.sessionRailEnabled
	) {
		return;
	}
	if (state.barSessionsVisible || state.sessionRailEnabled) return;
	useSessionWorkspaceStore.getState().clear();
});
