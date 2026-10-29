import { useEffect } from "react";
import { getPi } from "../api";
import { useSessionsStore } from "../stores/sessions";
import { useTranscriptStore } from "../stores/transcript";
import type { SessionGcEntry } from "./session-gc";
import { runSessionGcRound } from "./session-gc-run";

const KEEP = 3;

const TICK_MS = 20_000;

function entryOf(sessionId: string): SessionGcEntry | undefined {
	const entry = useTranscriptStore.getState().bySession[sessionId];
	if (!entry) return undefined;
	return {
		agentActive: entry.agentActive,
		pendingPermissions: entry.pendingPermissions,
		pendingDialogs: entry.pendingDialogs,
		unseenCompletion: entry.unseenCompletion,
		compacting: entry.compacting,
		followUpQueue: entry.followUpQueue,
		messageCount: entry.messages.length,
	};
}

export function useSessionGc(): void {
	useEffect(() => {
		let running = false;

		const run = async (): Promise<void> => {
			if (running) return;
			running = true;
			try {
				await runSessionGcRound({
					getOpen: () => {
						const state = useSessionsStore.getState();
						return {
							activeSessionId: state.activeSessionId,
							open: state.sessions.map((session) => ({
								sessionId: session.sessionId,

								lastUsedAt: state.lastUsedAt[session.sessionId] ?? 0,

								messageCount: session.messageCount,
							})),
						};
					},
					entryOf,
					listSubscriptionSessionIds: () => getPi().getChannelSubscriptionSessionIds(),
					unload: (sessionId) => useSessionsStore.getState().unloadSession(sessionId),
					now: Date.now(),
					keep: KEEP,
				});
			} finally {
				running = false;
			}
		};

		void run();
		const timer = window.setInterval(() => void run(), TICK_MS);

		const unsubscribe = useSessionsStore.subscribe((state, prev) => {
			if (state.sessions !== prev.sessions || state.activeSessionId !== prev.activeSessionId) void run();
		});
		return () => {
			window.clearInterval(timer);
			unsubscribe();
		};
	}, []);
}
