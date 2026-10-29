import type { AvailableModel, PermissionMode, SessionCloseIntent, SessionMeta } from "@tcode/shared";
import { messagesToUIMessages } from "@tcode/shared";
import { create } from "zustand";
import { getPi } from "../api";
import type { MenuAnchor } from "../components/ui/place-menu";
import { errText } from "../lib/error-text";
import { normalizeThinkingLevel } from "../lib/thinking";
import { randomUid } from "../lib/uid";
import { splitAnnotationMessage } from "../sidepane/panels/browserAnnotate";
import { useSidePaneStore } from "../sidepane/store";
import { useCheckpointsStore } from "./checkpoints";
import { COMPOSER_FOCUS_EVENT, NEW_SESSION_DRAFT_KEY, useDraftStore } from "./drafts";
import { useRecallConfirmStore } from "./recall-confirm";
import {
	clearSessionHistory,
	deferSessionHistory,
	finishSessionHistory,
	hasPendingSessionHistory,
	historyOpenEpoch,
	isHistoryReady,
	retrySessionHistory,
} from "./session-history";
import { useSessionWorkspaceStore } from "./session-workspace";
import { pushToast } from "./toasts";
import { useTranscriptStore } from "./transcript";
import { useUiPreferencesStore } from "./ui-preferences";

export interface NewSessionDraftConfig {
	cwd: string | null;

	model: { provider: string; modelId: string } | null;
	thinkingLevel: string;
	permissionMode: PermissionMode;

	modelResolved: boolean;

	thinkingResolved: boolean;

	generation: number;
}

let draftGenerationSeq = 0;

function makeDraft(
	state: Pick<SessionsStore, "cwd" | "lastUsedModel" | "lastUsedThinkingLevel">,
	source: {
		cwd?: string | null;
		model?: { provider: string; modelId: string } | null;
		thinkingLevel?: string | null;
	} = {},
): NewSessionDraftConfig {
	const model = source.model ?? null;
	draftGenerationSeq += 1;
	return {
		cwd: source.cwd ?? state.cwd,
		model,

		thinkingLevel: source.thinkingLevel ?? state.lastUsedThinkingLevel,
		permissionMode: "default",
		modelResolved: model != null,
		thinkingResolved: source.thinkingLevel != null,
		generation: draftGenerationSeq,
	};
}

export function partitionSessionsByPin(
	sessions: SessionMeta[],
	pinnedSessions: readonly string[],
): SessionMeta[] {
	if (pinnedSessions.length === 0) return sessions;
	const pinned = new Set(pinnedSessions);
	const pinnedList = sessions.filter((s) => pinned.has(s.sessionId));
	if (pinnedList.length === 0) return sessions;
	return [...pinnedList, ...sessions.filter((s) => !pinned.has(s.sessionId))];
}

export type OpenFromHistoryResult = { ok: false } | { ok: true; latest: boolean; meta: SessionMeta };

let activationSeq = 0;

export function currentNavigationToken(): number {
	return activationSeq;
}

export function isLatestNavigation(token: number): boolean {
	return token === activationSeq;
}

let userIntentSeq = 0;

function noteUserIntent(): void {
	userIntentSeq += 1;
}

export function currentUserIntentToken(): number {
	return userIntentSeq;
}

export function isLatestUserIntent(token: number): boolean {
	return token === userIntentSeq;
}

function claimActivation(): number {
	activationSeq += 1;
	return activationSeq;
}

function isLatestActivation(token: number): boolean {
	return token === activationSeq;
}

const bundleInFlight = new Map<string, Promise<void>>();

function remainingTurnsForRecall(
	sessionId: string,
	ref: { entryId?: string; text?: string; timestamp?: number },
): number {
	const users = (useTranscriptStore.getState().bySession[sessionId]?.messages ?? []).filter(
		(m) => m.kind === "user",
	);
	return users.findIndex((m) =>
		ref.entryId ? m.entryId === ref.entryId : ref.timestamp != null && m.timestamp === ref.timestamp,
	);
}

async function previewRecallFiles(
	sessionId: string,
	ref: { entryId?: string; text?: string; timestamp?: number },
): Promise<string[] | null> {
	const cwd = useSessionsStore.getState().sessions.find((s) => s.sessionId === sessionId)?.cwd;
	if (!cwd) return null;
	const list = await getPi()
		.checkpointListWithDiff({ sessionId, cwd })
		.catch(() => []);
	if (list.length === 0) return null;
	const remaining = remainingTurnsForRecall(sessionId, ref);
	if (remaining < 0) return [];
	if (!list.some((cp) => (cp.turn ?? 0) <= remaining)) return null;
	const discarded = list.filter((cp) => (cp.turn ?? 0) > remaining);
	if (discarded.length === 0) return null;

	return [...new Set(discarded.flatMap((cp) => cp.files.map((f) => f.path)))].sort();
}

async function revertFilesForRecall(sessionId: string): Promise<string[] | null> {
	const cwd = useSessionsStore.getState().sessions.find((s) => s.sessionId === sessionId)?.cwd;
	if (!cwd) return null;
	const list = await getPi()
		.checkpointList({ sessionId, cwd })
		.catch(() => []);
	if (list.length === 0) return null;

	const remaining = (useTranscriptStore.getState().bySession[sessionId]?.messages ?? []).filter(
		(m) => m.kind === "user",
	).length;
	const target = list
		.filter((cp) => (cp.turn ?? 0) <= remaining)
		.sort((a, b) => (b.turn ?? 0) - (a.turn ?? 0))[0];
	if (!target) return null;
	const restored = await getPi()
		.checkpointRestore({ sessionId, cwd, sha: target.sha })
		.catch(() => null);
	useCheckpointsStore.getState().bump();
	return restored?.changed ? (restored.files ?? []) : null;
}

function loadSessionBundle(sessionId: string, opts?: { skipHistoryIfLive?: boolean }): Promise<void> {
	const existing = bundleInFlight.get(sessionId);
	if (existing) return existing;
	const openingEpoch = historyOpenEpoch(sessionId);
	const promise = loadSessionBundleInner(sessionId, opts)
		.catch((error: unknown) => {
			if (
				historyOpenEpoch(sessionId) === openingEpoch &&
				!isHistoryReady(sessionId) &&
				useSessionsStore.getState().sessions.some((s) => s.sessionId === sessionId)
			) {
				deferSessionHistory(sessionId, () =>
					useSessionsStore.getState().sessions.some((s) => s.sessionId === sessionId),
				);
			}
			throw error;
		})
		.finally(() => {
			if (bundleInFlight.get(sessionId) === promise) bundleInFlight.delete(sessionId);
		});
	bundleInFlight.set(sessionId, promise);
	return promise;
}

async function loadSessionBundleInner(
	sessionId: string,
	opts?: { skipHistoryIfLive?: boolean },
): Promise<void> {
	const skipHistory =
		opts?.skipHistoryIfLive === true &&
		useTranscriptStore.getState().bySession[sessionId]?.agentActive === true;
	const transcriptBefore = useTranscriptStore.getState().bySession[sessionId];
	const openingEpoch = historyOpenEpoch(sessionId);
	const [history, followUpQueue, todos, permissionMode, storedPermissionMode] = await Promise.all([
		skipHistory ? Promise.resolve(null) : getPi().getSessionMessages({ sessionId }),
		getPi().getFollowUpMessages({ sessionId }),
		getPi().getTodos({ sessionId }),
		getPi().getPermissionMode({ sessionId }),

		getPi()
			.loadSessionPermissionMode({ sessionId })
			.catch(() => null),
	]);

	const transcriptNow = useTranscriptStore.getState().bySession[sessionId];
	const liveNow = transcriptNow?.agentActive === true;

	if (
		historyOpenEpoch(sessionId) !== openingEpoch ||
		!useSessionsStore.getState().sessions.some((s) => s.sessionId === sessionId)
	)
		return;
	const t = useTranscriptStore.getState();
	const historyNeedsRetry = !history || liveNow || transcriptBefore !== transcriptNow;
	if (history && !historyNeedsRetry) {
		t.loadHistory(sessionId, messagesToUIMessages(history));
		finishSessionHistory(sessionId);
	}
	t.setFollowUpQueue(sessionId, followUpQueue);
	t.loadTodos(sessionId, todos);
	applyBackendPermissionMode(sessionId, permissionMode);
	if (historyNeedsRetry) {
		deferSessionHistory(sessionId, () =>
			useSessionsStore.getState().sessions.some((s) => s.sessionId === sessionId),
		);
	}

	const remembered = storedPermissionMode;
	if (remembered && remembered !== permissionMode) {
		try {
			await getPi().setPermissionMode({ sessionId, mode: remembered });
			applyBackendPermissionMode(sessionId, remembered);
		} catch (error) {
			console.warn("恢复会话权限模式失败", error);
		}
	}
}

function applyBackendPermissionMode(sessionId: string, mode: PermissionMode): void {
	useSessionsStore.setState((state) => ({
		permissionModes: withPermissionMode(state.permissionModes, sessionId, mode),
	}));
}

async function restorePermissionMode(sessionId: string): Promise<void> {
	const mode = useSessionsStore.getState().permissionModes[sessionId];
	if (!mode || mode === "default") return;
	try {
		await getPi().setPermissionMode({ sessionId, mode });
	} catch (error) {
		console.warn("恢复会话权限模式失败", error);
		applyBackendPermissionMode(sessionId, "default");
		pushToast("warning", "toast.permissionModeFailed", errText(error));
	}
}

function withPermissionMode(
	map: Record<string, PermissionMode>,
	sessionId: string,
	mode: PermissionMode,
): Record<string, PermissionMode> {
	const next = { ...map };
	if (mode === "default") delete next[sessionId];
	else next[sessionId] = mode;
	return next;
}

async function optimisticSessionSetting(
	label: string,
	toastKey: "toast.modelSwitchFailed" | "toast.thinkingSwitchFailed",
	compute: () => {
		global: { lastUsedModel?: { provider: string; modelId: string } | null; lastUsedThinkingLevel?: string };

		sessionPatch: { model?: { provider: string; modelId: string } | null; thinkingLevel?: string | null };

		draftPatch: Partial<
			Pick<NewSessionDraftConfig, "model" | "thinkingLevel" | "modelResolved" | "thinkingResolved">
		>;

		uiState: { lastUsedModel?: { provider: string; modelId: string } | null; lastUsedThinkingLevel?: string };

		sync: (sessionId: string) => Promise<unknown>;
	},
): Promise<unknown> {
	const s = useSessionsStore.getState();
	const { activeSessionId } = s;

	const onDraftPage = activeSessionId === null;
	const previousGlobal = {
		lastUsedModel: s.lastUsedModel,
		lastUsedThinkingLevel: s.lastUsedThinkingLevel,
	};
	const previousSession = s.sessions.find((x) => x.sessionId === activeSessionId);
	const { global, sessionPatch, draftPatch, uiState, sync } = compute();
	const apply = (
		g: { lastUsedModel?: { provider: string; modelId: string } | null; lastUsedThinkingLevel?: string },
		patch: { model?: { provider: string; modelId: string } | null; thinkingLevel?: string | null },
		draft: Partial<
			Pick<NewSessionDraftConfig, "model" | "thinkingLevel" | "modelResolved" | "thinkingResolved">
		>,
	) =>
		useSessionsStore.setState((state) => ({
			...g,
			sessions: state.sessions.map((x) => (x.sessionId === activeSessionId ? { ...x, ...patch } : x)),

			newSessionDraft: state.newSessionDraft ? { ...state.newSessionDraft, ...draft } : null,
		}));
	apply(global, sessionPatch, onDraftPage ? draftPatch : {});
	getPi()
		.saveUiState({ state: uiState })
		.catch((error) => {
			console.error("ui-state 持久化失败", error);
			pushToast("warning", "toast.uiStateSaveFailed", errText(error));
		});

	if (onDraftPage) return undefined;
	try {
		return await sync(activeSessionId);
	} catch (error) {
		apply(
			previousGlobal,
			previousSession
				? { model: previousSession.model, thinkingLevel: previousSession.thinkingLevel }
				: { model: null, thinkingLevel: null },

			{},
		);
		getPi()
			.saveUiState({ state: previousGlobal })
			.catch((e) => console.error("ui-state 回滚持久化失败", e));
		console.error(`${label}失败`, error);
		pushToast("warning", toastKey, errText(error));
		return undefined;
	}
}

function adoptEffectiveThinkingLevel(reported: unknown): void {
	if (typeof reported !== "string") return;
	const effective = normalizeThinkingLevel(reported);
	const state = useSessionsStore.getState();
	const { activeSessionId } = state;
	const session = state.sessions.find((x) => x.sessionId === activeSessionId);
	if (state.lastUsedThinkingLevel === effective && (session?.thinkingLevel ?? null) === effective) return;
	useSessionsStore.setState((s) => ({
		lastUsedThinkingLevel: effective,
		sessions: s.sessions.map((x) =>
			x.sessionId === activeSessionId ? { ...x, thinkingLevel: effective } : x,
		),
	}));
	getPi()
		.saveUiState({ state: { lastUsedThinkingLevel: effective } })
		.catch((error) => console.error("ui-state 持久化失败", error));
}

function ensureOpenSession(filePath: string, opts?: { loadBundle?: boolean }): Promise<SessionMeta | null> {
	const key = filePath.trim();
	const existing = openInFlight.get(key);
	if (existing) return existing;
	const promise = ensureOpenSessionInner(key, opts?.loadBundle !== false).finally(() => {
		if (openInFlight.get(key) === promise) openInFlight.delete(key);
	});
	openInFlight.set(key, promise);
	return promise;
}

const openInFlight = new Map<string, Promise<SessionMeta | null>>();

async function ensureOpenSessionInner(filePath: string, loadBundle: boolean): Promise<SessionMeta | null> {
	let meta: SessionMeta;
	try {
		meta = await getPi().openSession({ filePath });
	} catch (error) {
		console.error("打开会话失败", error);
		pushToast("warning", "toast.sessionOpenFailed", errText(error));
		return null;
	}

	useSessionsStore.setState((state) => ({
		sessions: [
			...state.sessions.filter(
				(s) => s.sessionId !== meta.sessionId && (!meta.sessionFile || s.sessionFile !== meta.sessionFile),
			),
			meta,
		],
		lastUsedAt: { ...state.lastUsedAt, [meta.sessionId]: Date.now() },
	}));
	if (!loadBundle) return meta;
	try {
		await loadSessionBundle(meta.sessionId, { skipHistoryIfLive: true });
	} catch (error) {
		console.error("装载会话数据失败", error);
		pushToast("warning", "toast.sessionOpenFailed", errText(error));
	}
	return meta;
}

function rememberCwd(cwd: string | null): void {
	if (!cwd) return;
	useUiPreferencesStore.getState().setLastCwd(cwd);
}

function ensureTrust(cwd: string): void {
	void getPi()
		.ensureProjectTrust({ cwd })
		.then(() => useSessionsStore.setState((s) => ({ trustVersion: s.trustVersion + 1 })))
		.catch((error) => {
			console.error("项目信任检查失败", error);
			pushToast("warning", "toast.trustFailed", errText(error));
		});
}

let promotion: { generation: number; done: Promise<string | null> } | null = null;

async function promoteDraft(draft: NewSessionDraftConfig): Promise<string | null> {
	noteUserIntent();
	const targetCwd = draft.cwd;
	if (!targetCwd) return null;
	const token = claimActivation();
	try {
		const meta = await getPi().createSession({
			options: {
				cwd: targetCwd,
				...(draft.model ?? {}),
				thinkingLevel: draft.thinkingLevel,
			},
		});

		useSessionWorkspaceStore
			.getState()
			.addMember(
				{ file: meta.sessionFile, sessionId: meta.sessionId },
				{ activate: isLatestActivation(token) },
			);

		if (isLatestActivation(token)) {
			useSidePaneStore.getState().adoptDraftOwner(NEW_SESSION_DRAFT_KEY, meta.sessionId);
		}
		useSessionsStore.setState((state) => {
			const sessions = state.sessions.some((s) => s.sessionId === meta.sessionId)
				? state.sessions
				: [...state.sessions, meta];
			const landed = { sessions, lastUsedAt: { ...state.lastUsedAt, [meta.sessionId]: Date.now() } };
			if (isLatestActivation(token)) {
				return { ...landed, newSessionDraft: null, activeSessionId: meta.sessionId, cwd: targetCwd };
			}

			return {
				...landed,

				newSessionDraft:
					state.activeSessionId === null
						? (state.newSessionDraft ?? makeDraft(state, { cwd: state.cwd }))
						: null,
			};
		});
		useTranscriptStore.getState().resetSession(meta.sessionId);

		finishSessionHistory(meta.sessionId);
		if (isLatestActivation(token)) {
			rememberCwd(targetCwd);

			adoptEffectiveThinkingLevel(meta.thinkingLevel);
		}

		if (draft.permissionMode !== "default") {
			await useSessionsStore.getState().setSessionPermissionMode(meta.sessionId, draft.permissionMode);
		}
		return meta.sessionId;
	} catch (error) {
		console.error("创建会话失败", error);
		pushToast("warning", "toast.sessionCreateFailed", errText(error));
		return null;
	}
}

interface SessionsStore {
	sessions: SessionMeta[];
	activeSessionId: string | null;
	cwd: string | null;
	models: AvailableModel[];

	newSessionDraft: NewSessionDraftConfig | null;

	lastUsedModel: { provider: string; modelId: string } | null;
	lastUsedThinkingLevel: string;

	trustVersion: number;

	permissionModes: Record<string, PermissionMode>;

	lastUsedAt: Record<string, number>;

	createSession: () => Promise<string | null>;

	activateNewSessionDraft: (cwd?: string) => void;

	activateNewSessionDraftForCwd: (cwd: string) => void;

	setDraftCwd: (cwd: string) => void;

	setDraftPermissionMode: (mode: PermissionMode) => void;
	switchSession: (sessionId: string) => void;
	closeSession: (sessionId: string, intent?: SessionCloseIntent) => Promise<{ closed: boolean }>;

	unloadSession: (sessionId: string) => Promise<{ closed: boolean }>;
	openFromHistory: (filePath: string) => Promise<OpenFromHistoryResult>;

	inspectSession: (filePath: string) => Promise<SessionMeta | null>;

	forkSession: (ref: { entryId?: string; text?: string }) => Promise<string | undefined>;

	recallMessage: (
		ref: { entryId?: string; text?: string; timestamp?: number },
		anchor?: MenuAnchor,
	) => Promise<void>;

	updateSessionName: (sessionId: string, name: string | undefined) => void;
	pickDirectory: () => Promise<void>;
	loadModels: () => Promise<void>;
	setCurrentModel: (provider: string, modelId: string) => Promise<void>;
	setThinkingLevel: (level: string) => Promise<void>;

	setSessionPermissionMode: (sessionId: string, mode: PermissionMode) => Promise<void>;
}

export const useSessionsStore = create<SessionsStore>((set, get) => ({
	sessions: [],
	activeSessionId: null,
	cwd: null,
	models: [],

	newSessionDraft: makeDraft({ cwd: null, lastUsedModel: null, lastUsedThinkingLevel: "medium" }),
	lastUsedModel: null,
	lastUsedThinkingLevel: "medium",
	trustVersion: 0,
	permissionModes: {},
	lastUsedAt: {},

	createSession: () => {
		const draft = get().newSessionDraft;

		if (!draft?.cwd) return Promise.resolve(null);

		if (promotion?.generation === draft.generation) return promotion.done;
		const done = promoteDraft(draft);
		const self = { generation: draft.generation, done };
		promotion = self;
		void done.finally(() => {
			if (promotion === self) promotion = null;
		});
		return done;
	},

	activateNewSessionDraft: (cwd) => {
		const state = get();

		noteUserIntent();
		const activeSession = state.sessions.find((s) => s.sessionId === state.activeSessionId);
		if (activeSession) {
			const targetCwd = cwd ?? activeSession.cwd;
			claimActivation();
			const nextDraft = makeDraft(state, {
				cwd: targetCwd,
				model: activeSession.model ?? state.lastUsedModel,
				thinkingLevel: activeSession.thinkingLevel,
			});
			nextDraft.permissionMode = state.permissionModes[activeSession.sessionId] ?? "default";
			set({ activeSessionId: null, cwd: targetCwd, newSessionDraft: nextDraft });
			ensureTrust(targetCwd);
			return;
		}

		const existing = state.newSessionDraft;
		if (existing) {
			const targetCwd = existing.cwd ?? cwd ?? state.cwd;
			set({
				activeSessionId: null,
				cwd: targetCwd,
				newSessionDraft: { ...existing, cwd: targetCwd },
			});
			if (targetCwd) ensureTrust(targetCwd);
			return;
		}

		const targetCwd = cwd ?? state.cwd;
		set({
			activeSessionId: null,
			cwd: targetCwd,
			newSessionDraft: makeDraft(state, { cwd: targetCwd }),
		});
		if (targetCwd) ensureTrust(targetCwd);
	},

	activateNewSessionDraftForCwd: (cwd) => {
		const state = get();
		const activeSession = state.sessions.find((s) => s.sessionId === state.activeSessionId);

		claimActivation();
		noteUserIntent();
		const existing = state.newSessionDraft;
		draftGenerationSeq += existing ? 1 : 0;
		const newSessionDraft = existing
			? { ...existing, cwd, generation: draftGenerationSeq }
			: makeDraft(state, {
					cwd,
					model: activeSession?.model ?? state.lastUsedModel,
					thinkingLevel: activeSession?.thinkingLevel,
				});
		set({ activeSessionId: null, cwd, newSessionDraft });
		ensureTrust(cwd);
		rememberCwd(cwd);
	},

	setDraftCwd: (cwd) => {
		ensureTrust(cwd);
		set((state) => ({
			cwd,
			newSessionDraft: state.newSessionDraft ? { ...state.newSessionDraft, cwd } : state.newSessionDraft,
		}));

		rememberCwd(cwd);
	},

	setDraftPermissionMode: (mode) => {
		set((state) => ({
			newSessionDraft: state.newSessionDraft ? { ...state.newSessionDraft, permissionMode: mode } : null,
		}));
	},

	switchSession: (sessionId) => {
		claimActivation();
		noteUserIntent();
		set((state) => {
			const session = state.sessions.find((s) => s.sessionId === sessionId);
			return {
				activeSessionId: sessionId,
				cwd: session?.cwd ?? state.cwd,
				lastUsedAt: { ...state.lastUsedAt, [sessionId]: Date.now() },
			};
		});

		if (!isHistoryReady(sessionId) && hasPendingSessionHistory(sessionId)) {
			void retrySessionHistory(sessionId);
		} else if (useTranscriptStore.getState().bySession[sessionId] === undefined) {
			void loadSessionBundle(sessionId).catch((error) => {
				console.error("切换会话时补拉数据失败", error);
				pushToast("warning", "toast.sessionOpenFailed", errText(error));
			});
		}
		rememberCwd(get().cwd);
	},

	updateSessionName: (sessionId, name) =>
		set((state) => ({
			sessions: state.sessions.map((s) => (s.sessionId === sessionId ? { ...s, name } : s)),
		})),

	closeSession: async (sessionId, intent) => {
		try {
			const { closed } = await getPi().closeSession(intent ? { sessionId, intent } : { sessionId });

			if (!closed) return { closed: false };

			if (intent === "gc" && get().activeSessionId === sessionId) {
				const file = get().sessions.find((s) => s.sessionId === sessionId)?.sessionFile;
				if (file && (await ensureOpenSession(file, { loadBundle: false }))) {
					await restorePermissionMode(sessionId);
					return { closed: false };
				}
			}
		} catch (error) {
			console.error("关闭会话失败", error);
			pushToast("warning", "toast.closeFailed", errText(error));
			return { closed: false };
		}
		clearSessionHistory(sessionId);
		const closedFile = get().sessions.find((s) => s.sessionId === sessionId)?.sessionFile;
		if (closedFile) openInFlight.delete(closedFile.trim());
		bundleInFlight.delete(sessionId);
		useTranscriptStore.getState().resetSession(sessionId);
		set((state) => {
			const closing = state.sessions.find((s) => s.sessionId === sessionId);
			const sessions = state.sessions.filter((s) => s.sessionId !== sessionId);
			const activeSessionId =
				state.activeSessionId === sessionId ? (sessions[0]?.sessionId ?? null) : state.activeSessionId;

			const fallbackCwd = activeSessionId
				? (sessions.find((s) => s.sessionId === activeSessionId)?.cwd ?? state.cwd)
				: state.cwd;

			const newSessionDraft =
				activeSessionId === null
					? (state.newSessionDraft ??
						makeDraft(state, {
							cwd: fallbackCwd,
							model: closing?.model,
							thinkingLevel: closing?.thinkingLevel,
						}))
					: state.newSessionDraft;

			const cwd = activeSessionId === null ? (newSessionDraft?.cwd ?? null) : fallbackCwd;

			const permissionModes = withPermissionMode(state.permissionModes, sessionId, "default");

			const lastUsedAt = { ...state.lastUsedAt };
			delete lastUsedAt[sessionId];
			return {
				sessions,
				activeSessionId,
				cwd,
				permissionModes,
				lastUsedAt,
				newSessionDraft,
			};
		});
		return { closed: true };
	},

	unloadSession: (sessionId) => get().closeSession(sessionId, "gc"),

	openFromHistory: async (filePath) => {
		const token = claimActivation();
		noteUserIntent();
		const meta = await ensureOpenSession(filePath);

		if (!meta) return { ok: false };

		if (!isLatestActivation(token)) return { ok: true, latest: false, meta };
		set({ activeSessionId: meta.sessionId, cwd: meta.cwd });

		rememberCwd(meta.cwd);
		return { ok: true, latest: true, meta };
	},

	inspectSession: (filePath) => ensureOpenSession(filePath),

	forkSession: async (ref) => {
		const { activeSessionId } = get();

		if (!activeSessionId) return undefined;

		const token = claimActivation();
		noteUserIntent();
		try {
			const meta = await getPi().forkSession({ sessionId: activeSessionId, ref });

			const latest = isLatestActivation(token);
			useSessionWorkspaceStore
				.getState()
				.addMember({ file: meta.sessionFile, sessionId: meta.sessionId }, { activate: latest });
			set((state) => {
				const sessions = [...state.sessions.filter((s) => s.sessionId !== meta.sessionId), meta];

				return latest ? { sessions, activeSessionId: meta.sessionId } : { sessions };
			});
			await loadSessionBundle(meta.sessionId);

			return meta.sessionId;
		} catch (error) {
			console.error("分叉会话失败", error);
			pushToast("warning", "toast.forkFailed", errText(error));
			return undefined;
		}
	},

	recallMessage: async (ref, anchor) => {
		const { activeSessionId } = get();

		if (!activeSessionId) return;
		try {
			const preview = await previewRecallFiles(activeSessionId, ref);
			if (preview && anchor && !(await useRecallConfirmStore.getState().ask(preview, anchor))) return;
			const recalled = await getPi().recallMessage({ sessionId: activeSessionId, ref });

			const segments = splitAnnotationMessage(recalled.text);
			const commands = segments.filter((s) => s.kind === "card").map((s) => s.command);
			const plainText = segments
				.filter((s) => s.kind === "text")
				.map((s) => s.text)
				.join("")
				.replace(/\s+$/, "");
			useDraftStore.getState().updateDraft(activeSessionId, (d) => ({
				...d,
				text: [d.text, plainText].filter(Boolean).join("\n"),
				annotations: commands.length
					? [...d.annotations, ...commands.map((command) => ({ id: randomUid(), command }))]
					: d.annotations,
				images: recalled.images.length > 0 ? [...d.images, ...recalled.images] : d.images,
			}));

			await loadSessionBundle(activeSessionId);

			await revertFilesForRecall(activeSessionId);
			window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_EVENT));
		} catch (error) {
			console.error("撤回消息失败", error);
			pushToast("warning", "toast.recallFailed", errText(error));
		}
	},

	pickDirectory: async () => {
		const cwd = await getPi().pickDirectory();

		if (cwd) get().setDraftCwd(cwd);
	},

	loadModels: async () => {
		try {
			const models = await getPi().listModels();

			const saved = await getPi().loadUiState();
			const savedModel =
				saved?.lastUsedModel &&
				models.some(
					(m) => m.provider === saved.lastUsedModel?.provider && m.id === saved.lastUsedModel?.modelId,
				)
					? saved.lastUsedModel
					: null;
			const current = get().lastUsedModel;
			const fallback = models.find((m) => m.authed) ?? models[0];
			const nextLastUsedModel =
				savedModel ?? current ?? (fallback ? { provider: fallback.provider, modelId: fallback.id } : null);

			const rawLevel = normalizeThinkingLevel(saved?.lastUsedThinkingLevel ?? get().lastUsedThinkingLevel);
			const clampedLevel = rawLevel;

			const draft = get().newSessionDraft;
			const draftModel = draft?.modelResolved ? draft.model : nextLastUsedModel;
			set({
				models,
				lastUsedModel: nextLastUsedModel,
				lastUsedThinkingLevel: clampedLevel,

				newSessionDraft: draft
					? {
							...draft,
							model: draftModel,
							thinkingLevel: draft.thinkingResolved ? draft.thinkingLevel : clampedLevel,
						}
					: null,
			});
		} catch (error) {
			console.error("加载模型列表失败", error);
			pushToast("warning", "toast.modelsLoadFailed", errText(error));
		}
	},

	setCurrentModel: async (provider, modelId) => {
		const state = get();
		const thinkingLevel = state.lastUsedThinkingLevel;
		const effective = await optimisticSessionSetting("切换模型", "toast.modelSwitchFailed", () => ({
			global: { lastUsedModel: { provider, modelId }, lastUsedThinkingLevel: thinkingLevel },
			sessionPatch: { model: { provider, modelId }, thinkingLevel },

			draftPatch: {
				model: { provider, modelId },
				thinkingLevel,
				modelResolved: true,
				thinkingResolved: true,
			},
			uiState: { lastUsedModel: { provider, modelId }, lastUsedThinkingLevel: thinkingLevel },
			sync: (sessionId) => getPi().setModel({ sessionId, provider, modelId }),
		}));
		adoptEffectiveThinkingLevel(effective);
	},

	setThinkingLevel: async (level) => {
		const effective = await optimisticSessionSetting("切换思考深度", "toast.thinkingSwitchFailed", () => ({
			global: { lastUsedThinkingLevel: level },
			sessionPatch: { thinkingLevel: level },

			draftPatch: { thinkingLevel: level, thinkingResolved: true },
			uiState: { lastUsedThinkingLevel: level },
			sync: (sessionId) => getPi().setThinkingLevel({ sessionId, level }),
		}));
		adoptEffectiveThinkingLevel(effective);
	},

	setSessionPermissionMode: async (sessionId, mode) => {
		const previous = get().permissionModes[sessionId] ?? "default";
		set((state) => ({ permissionModes: withPermissionMode(state.permissionModes, sessionId, mode) }));
		try {
			await getPi().setPermissionMode({ sessionId, mode });

			useUiPreferencesStore.getState().rememberPermissionMode(sessionId, mode);
		} catch (error) {
			set((state) => ({ permissionModes: withPermissionMode(state.permissionModes, sessionId, previous) }));
			console.error("切换权限模式失败", error);
			pushToast("warning", "toast.permissionModeFailed", errText(error));
		}
	},
}));

useSessionsStore.subscribe((state, prev) => {
	if (state.activeSessionId === prev.activeSessionId) return;
	const { members, setActive } = useSessionWorkspaceStore.getState();
	setActive(members.find((m) => m.sessionId === state.activeSessionId)?.file ?? null);
});
