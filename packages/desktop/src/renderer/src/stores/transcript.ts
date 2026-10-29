import type {
	ExtensionDialogRequest,
	SessionEvent,
	PermissionRequest as SharedPermissionRequest,
	TodoItem,
} from "@tcode/shared";
import {
	type ActivityEntry,
	emptyTranscript,
	reduceEvent,
	type SessionPhase,
	type SessionTranscriptState,
	type StreamingState,
	type SubagentRunUi,
	type UIMessage,
	type UIToolCall,
} from "@tcode/shared";
import { create } from "zustand";
import { handleAgentSettled, noteToolActivity, noteToolOutput, toolResultText } from "../lib/site-preview";

export type { ActivityEntry, SessionPhase, StreamingState, SubagentRunUi, UIMessage, UIToolCall };

export type PermissionRequest = SharedPermissionRequest;

export interface SessionEntry extends SessionTranscriptState {
	pendingPermissions: PermissionRequest[];

	pendingDialogs: ExtensionDialogRequest[];

	extensionPrefillSource?: string;
}

const EMPTY_ENTRY: SessionEntry = { ...emptyTranscript(), pendingPermissions: [], pendingDialogs: [] };

export const EMPTY_TODOS: TodoItem[] = [];

interface TranscriptStore {
	bySession: Record<string, SessionEntry>;

	applyEvent: (sessionId: string, event: SessionEvent, opts?: { isActiveViewing?: boolean }) => void;

	markAgentActive: (sessionId: string, active: boolean) => void;

	markCompletionSeen: (sessionId: string) => void;
	addPermission: (sessionId: string, req: PermissionRequest) => void;
	resolvePermission: (sessionId: string, requestId: string) => void;

	addExtensionDialog: (sessionId: string, req: ExtensionDialogRequest) => void;
	resolveExtensionDialog: (sessionId: string, requestId: string) => void;

	markExtensionPrefill: (sessionId: string, source: string) => void;
	clearExtensionPrefill: (sessionId: string) => void;
	resetSession: (sessionId: string) => void;

	loadHistory: (sessionId: string, messages: UIMessage[]) => void;

	setFollowUpQueue: (sessionId: string, queue: string[]) => void;

	loadTodos: (sessionId: string, todos: TodoItem[]) => void;
}

export const useTranscriptStore = create<TranscriptStore>((set, get) => ({
	bySession: {},
	applyEvent: (sessionId, event, opts) => {
		const wasAgentActive = get().bySession[sessionId]?.agentActive ?? false;
		set((state) => {
			const current = state.bySession[sessionId];
			const prev = current ?? emptyTranscript();
			const next = reduceEvent(prev, event);

			let unseenCompletion = prev.unseenCompletion;
			if (next.agentActive) unseenCompletion = false;
			else if (prev.agentActive && !opts?.isActiveViewing) unseenCompletion = true;
			return {
				bySession: {
					...state.bySession,
					[sessionId]: {
						...next,
						unseenCompletion,
						pendingPermissions: current?.pendingPermissions ?? [],
						pendingDialogs: current?.pendingDialogs ?? [],
						extensionPrefillSource: current?.extensionPrefillSource,
					},
				},
			};
		});

		if (event.type === "tool_execution_end") {
			noteToolActivity(sessionId, event.toolName);
			if (event.toolName === "bash") {
				const tool = get().bySession[sessionId]?.streaming?.tools.find((t) => t.id === event.toolCallId);
				noteToolOutput(sessionId, `${tool?.output ?? ""}\n${toolResultText(event.result)}`);
			}
		}

		if (wasAgentActive && opts?.isActiveViewing) {
			const after = get().bySession[sessionId];
			if (after && !after.agentActive) handleAgentSettled(sessionId);
		}
	},
	markAgentActive: (sessionId, active) => {
		set((state) => {
			const current = state.bySession[sessionId];
			if (!current) return state;
			return {
				bySession: {
					...state.bySession,

					[sessionId]: {
						...current,
						agentActive: active,
						unseenCompletion: active ? false : current.unseenCompletion,
					},
				},
			};
		});
	},
	markCompletionSeen: (sessionId) => {
		set((state) => {
			const current = state.bySession[sessionId];
			if (!current?.unseenCompletion) return state;
			return {
				bySession: {
					...state.bySession,
					[sessionId]: { ...current, unseenCompletion: false },
				},
			};
		});
	},
	addPermission: (sessionId, req) => {
		set((state) => {
			const current = state.bySession[sessionId];
			return {
				bySession: {
					...state.bySession,
					[sessionId]: {
						...(current ?? { ...EMPTY_ENTRY }),
						pendingPermissions: [...(current?.pendingPermissions ?? []), req],
						phase: "awaiting_permission",
					},
				},
			};
		});
	},
	addExtensionDialog: (sessionId, req) => {
		set((state) => {
			const current = state.bySession[sessionId];
			return {
				bySession: {
					...state.bySession,
					[sessionId]: {
						...(current ?? { ...EMPTY_ENTRY }),
						pendingDialogs: [...(current?.pendingDialogs ?? []), req],
					},
				},
			};
		});
	},
	resolveExtensionDialog: (sessionId, requestId) => {
		set((state) => {
			const current = state.bySession[sessionId];
			if (!current) return state;
			const pendingDialogs = current.pendingDialogs.filter((d) => d.id !== requestId);
			if (pendingDialogs.length === current.pendingDialogs.length) return state;
			return {
				bySession: {
					...state.bySession,
					[sessionId]: { ...current, pendingDialogs },
				},
			};
		});
	},
	markExtensionPrefill: (sessionId, source) => {
		set((state) => {
			const current = state.bySession[sessionId];
			return {
				bySession: {
					...state.bySession,
					[sessionId]: { ...(current ?? { ...EMPTY_ENTRY }), extensionPrefillSource: source || undefined },
				},
			};
		});
	},
	clearExtensionPrefill: (sessionId) => {
		set((state) => {
			const current = state.bySession[sessionId];
			if (!current?.extensionPrefillSource) return state;
			return {
				bySession: {
					...state.bySession,
					[sessionId]: { ...current, extensionPrefillSource: undefined },
				},
			};
		});
	},
	resolvePermission: (sessionId, requestId) => {
		set((state) => {
			const current = state.bySession[sessionId];
			if (!current) return state;
			const pendingPermissions = current.pendingPermissions.filter((p) => p.id !== requestId);
			return {
				bySession: {
					...state.bySession,
					[sessionId]: { ...current, pendingPermissions },
				},
			};
		});
	},
	resetSession: (sessionId) => {
		set((state) => {
			if (!(sessionId in state.bySession)) return state;
			const bySession = { ...state.bySession };
			delete bySession[sessionId];
			return { bySession };
		});
	},
	loadHistory: (sessionId, messages) => {
		set((state) => {
			const current = state.bySession[sessionId];
			const notices =
				current?.messages.filter((message) => message.kind === "system" && !message.compact) ?? [];
			return {
				bySession: {
					...state.bySession,
					[sessionId]: {
						messages: [...notices, ...messages],
						streaming: null,
						phase: "idle",
						agentActive: false,
						unseenCompletion: false,
						compacting: false,
						followUpQueue: current?.followUpQueue ?? [],

						todos: current?.todos ?? [],

						pendingLlmError: null,
						retrying: null,
						pendingPermissions: current?.pendingPermissions ?? [],
						pendingDialogs: current?.pendingDialogs ?? [],
						extensionPrefillSource: current?.extensionPrefillSource,
					},
				},
			};
		});
	},
	setFollowUpQueue: (sessionId, queue) => {
		set((state) => {
			const current = state.bySession[sessionId];
			return {
				bySession: {
					...state.bySession,
					[sessionId]: {
						...(current ?? { ...EMPTY_ENTRY }),
						followUpQueue: queue,
					},
				},
			};
		});
	},
	loadTodos: (sessionId, todos) => {
		set((state) => {
			const current = state.bySession[sessionId];
			return {
				bySession: {
					...state.bySession,
					[sessionId]: {
						...(current ?? { ...EMPTY_ENTRY }),
						todos,
					},
				},
			};
		});
	},
}));

export function selectTranscript(state: TranscriptStore, sessionId: string | null): SessionEntry {
	if (!sessionId) return EMPTY_ENTRY;
	return state.bySession[sessionId] ?? EMPTY_ENTRY;
}
