import type { SessionMeta } from "@tcode/shared";
import { create } from "zustand";
import { getPi } from "../api";
import { initDailyDir, isDailyCwd } from "../lib/daily";
import { isPrimaryNavigationSession } from "../lib/session-visibility";
import { useSessionWorkspaceStore } from "./session-workspace";
import { partitionSessionsByPin, useSessionsStore } from "./sessions";
import { useUiPreferencesStore } from "./ui-preferences";

const ADDED_KEY = "pi-desktop.projects";

function loadAddedProjects(): string[] {
	try {
		const raw = localStorage.getItem(ADDED_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
	} catch {
		return [];
	}
}

export interface ProjectEntry {
	cwd: string;

	name: string;
	sessionCount: number;

	lastActive: number;

	addedIndex: number;
}

interface ProjectsStore {
	allSessions: SessionMeta[];

	addedProjects: string[];
	selectedCwd: string | null;
	search: string;
	loading: boolean;
	loaded: boolean;

	load: () => Promise<void>;

	adoptCatalog: (sessions: SessionMeta[]) => void;

	applySessionName: (sessionId: string, name: string | undefined) => void;
	select: (cwd: string | null) => void;
	setSearch: (search: string) => void;
	addProject: () => Promise<void>;

	deleteSession: (session: SessionMeta) => Promise<void>;

	archiveSession: (session: SessionMeta) => Promise<void>;

	deleteProject: (cwd: string) => Promise<void>;

	openSession: (session: SessionMeta) => Promise<void>;
}

let loadSeq = 0;

export const useProjectsStore = create<ProjectsStore>((set, get) => {
	const applyCatalog = (allSessions: SessionMeta[]): void => {
		set({ allSessions, loading: false, loaded: true });
		absorbOpenSessions(useSessionsStore.getState().sessions);
		const { selectedCwd } = get();
		if (!selectedCwd) {
			const projects = deriveProjects(get());
			if (projects[0]) set({ selectedCwd: projects[0].cwd });
		}
	};

	return {
		allSessions: [],
		addedProjects: loadAddedProjects(),
		selectedCwd: null,
		search: "",
		loading: false,
		loaded: false,

		load: async () => {
			const seq = ++loadSeq;
			set({ loading: true });
			try {
				const [allSessions] = await Promise.all([getPi().listAllSessions(), initDailyDir()]);

				if (seq !== loadSeq) return;
				applyCatalog(allSessions);
			} catch {
				if (seq !== loadSeq) return;
				set({ loading: false, loaded: true });
			}
		},

		adoptCatalog: (sessions) => {
			loadSeq += 1;
			applyCatalog(sessions);
		},

		select: (cwd) => set({ selectedCwd: cwd, search: "" }),

		setSearch: (search) => set({ search }),

		addProject: async () => {
			const cwd = await getPi().pickDirectory();
			if (!cwd) return;

			void getPi()
				.ensureProjectTrust({ cwd })
				.catch(() => {});
			const added = get().addedProjects;
			if (!added.includes(cwd)) {
				const next = [...added, cwd];
				localStorage.setItem(ADDED_KEY, JSON.stringify(next));
				set({ addedProjects: next });
			}
			set({ selectedCwd: cwd });
		},

		applySessionName: (sessionId, name) => {
			set((state) => ({
				allSessions: state.allSessions.map((s) => (s.sessionId === sessionId ? { ...s, name } : s)),
			}));
		},

		archiveSession: async (session) => {
			if (!session.sessionFile) return get().deleteSession(session);
			const result = await getPi().archiveSession({
				sessionId: session.sessionId,
				sessionFile: session.sessionFile,
				cwd: session.cwd,
				name: session.name,
			});

			if (!result.ok) throw new Error(result.reason ?? "archive-failed");

			useUiPreferencesStore.getState().unpin(session.sessionId);
			useUiPreferencesStore.getState().forgetPermissionMode(session.sessionId);
			useSessionWorkspaceStore.getState().removeMember(session.sessionId);
			const sessionsState = useSessionsStore.getState();
			if (sessionsState.sessions.some((s) => s.sessionId === session.sessionId)) {
				await sessionsState.closeSession(session.sessionId);
			}
			set((state) => ({
				allSessions: state.allSessions.filter((s) => s.sessionId !== session.sessionId),
			}));
		},
		deleteSession: async (session) => {
			await getPi().deleteSession({ sessionId: session.sessionId, sessionFile: session.sessionFile });

			useUiPreferencesStore.getState().unpin(session.sessionId);

			useUiPreferencesStore.getState().forgetPermissionMode(session.sessionId);

			useSessionWorkspaceStore.getState().removeMember(session.sessionId);
			const sessionsState = useSessionsStore.getState();
			if (sessionsState.sessions.some((s) => s.sessionId === session.sessionId)) {
				await sessionsState.closeSession(session.sessionId);
			}
			set((state) => ({
				allSessions: state.allSessions.filter((s) => s.sessionId !== session.sessionId),
			}));
		},

		deleteProject: async (cwd) => {
			if (isDailyCwd(cwd)) return;
			const { allSessions } = get();
			for (const session of allSessions.filter((s) => s.cwd === cwd)) {
				await get().deleteSession(session);
			}
			const added = get().addedProjects.filter((p) => p !== cwd);
			localStorage.setItem(ADDED_KEY, JSON.stringify(added));
			set({ addedProjects: added });
			const { selectedCwd } = get();
			if (selectedCwd === cwd) {
				const projects = deriveProjects(get());
				set({ selectedCwd: projects[0]?.cwd ?? null, search: "" });
			}
		},

		openSession: async (session) => {
			const sessionsState = useSessionsStore.getState();

			const anchorFile = useSessionWorkspaceStore.getState().anchorFile();
			const record = (meta: SessionMeta, activate: boolean): void => {
				if (!isPrimaryNavigationSession(meta)) return;
				useSessionWorkspaceStore
					.getState()
					.addMember({ file: meta.sessionFile, sessionId: meta.sessionId }, { anchorFile, activate });
			};

			const opened = sessionsState.sessions.find((s) => s.sessionId === session.sessionId);
			if (opened) {
				sessionsState.switchSession(opened.sessionId);
				record(opened, true);
				return;
			}
			const result = await sessionsState.openFromHistory(session.sessionFile ?? "");

			if (result.ok) record(result.meta, result.latest);
		},
	};
});

function absorbOpenSessions(open: readonly SessionMeta[]): void {
	const state = useProjectsStore.getState();
	const known = new Set(state.allSessions.map((session) => session.sessionId));
	const missing = open.filter((session) => !known.has(session.sessionId));
	if (missing.length === 0) return;
	useProjectsStore.setState({ allSessions: [...state.allSessions, ...missing] });
}

useSessionsStore.subscribe((state, prev) => {
	if (state.sessions !== prev.sessions) absorbOpenSessions(state.sessions);
});

export function deriveProjects(state: Pick<ProjectsStore, "allSessions" | "addedProjects">): ProjectEntry[] {
	const byCwd = new Map<string, ProjectEntry>();
	for (const session of state.allSessions) {
		if (!session.cwd || isDailyCwd(session.cwd)) continue;
		const name = session.cwd.split("/").filter(Boolean).pop() ?? session.cwd;
		const modified = session.modifiedAt ?? session.createdAt;
		const existing = byCwd.get(session.cwd);
		if (existing) {
			existing.sessionCount += 1;
			existing.lastActive = Math.max(existing.lastActive, modified);
		} else {
			byCwd.set(session.cwd, {
				cwd: session.cwd,
				name,
				sessionCount: 1,
				lastActive: modified,
				addedIndex: -1,
			});
		}
	}
	for (const [idx, cwd] of state.addedProjects.entries()) {
		if (isDailyCwd(cwd)) continue;
		const existing = byCwd.get(cwd);
		if (existing) {
			existing.addedIndex = idx;
		} else {
			byCwd.set(cwd, {
				cwd,
				name: cwd.split("/").filter(Boolean).pop() ?? cwd,
				sessionCount: 0,
				lastActive: 0,
				addedIndex: idx,
			});
		}
	}
	return [...byCwd.values()].sort((a, b) => b.addedIndex - a.addedIndex || b.lastActive - a.lastActive);
}

export function deriveSessions(
	state: Pick<ProjectsStore, "allSessions" | "selectedCwd" | "search"> & {
		pinnedSessions: readonly string[];
	},
): SessionMeta[] {
	if (!state.selectedCwd) return [];
	const query = state.search.trim().toLowerCase();
	const filtered = state.allSessions
		.filter((s) => s.cwd === state.selectedCwd)
		.filter((s) => !query || (s.name ?? "").toLowerCase().includes(query) || s.sessionId.includes(query))
		.sort((a, b) => (b.modifiedAt ?? b.createdAt) - (a.modifiedAt ?? a.createdAt));
	return partitionSessionsByPin(filtered, state.pinnedSessions);
}
