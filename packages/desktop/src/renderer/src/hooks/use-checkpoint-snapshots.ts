import { useEffect, useRef } from "react";
import { getPi } from "../api";
import { useCheckpointsStore } from "../stores/checkpoints";
import { useSessionsStore } from "../stores/sessions";
import { useTranscriptStore } from "../stores/transcript";

const APP_STARTED_AT = Date.now();

export function useCheckpointSnapshots(): void {
	const sessions = useSessionsStore((s) => s.sessions);

	const activeKey = useTranscriptStore((s) =>
		sessions.map((m) => `${m.sessionId}:${s.bySession[m.sessionId]?.agentActive === true ? 1 : 0}`).join("|"),
	);
	const baselined = useRef(new Set<string>());
	const prevActive = useRef(new Map<string, boolean>());
	const turnStartAt = useRef(new Map<string, number>());

	useEffect(() => {
		for (const meta of sessions) {
			if (!meta.cwd || baselined.current.has(meta.sessionId)) continue;
			if (meta.createdAt < APP_STARTED_AT) continue;
			baselined.current.add(meta.sessionId);
			const { sessionId, cwd } = meta;
			void (async () => {
				const existing = await getPi()
					.checkpointList({ sessionId, cwd })
					.catch(() => []);
				if (existing.length > 0) return;
				await getPi()
					.checkpointCreate({ sessionId, cwd, message: "initial", allowEmpty: true })
					.then(() => useCheckpointsStore.getState().bump())
					.catch(() => {});
			})();
		}
	}, [sessions]);

	useEffect(() => {
		void activeKey;
		const entries = useTranscriptStore.getState().bySession;
		for (const meta of sessions) {
			const sid = meta.sessionId;
			const active = entries[sid]?.agentActive === true;
			const prev = prevActive.current.get(sid) ?? false;
			prevActive.current.set(sid, active);
			if (!meta.cwd) continue;

			if (!prev && active) {
				turnStartAt.current.set(sid, Date.now());
				void getPi()
					.checkpointMarkTurnStart({ sessionId: sid, cwd: meta.cwd })
					.catch(() => {});
				continue;
			}
			if (prev && !active) {
				const since = turnStartAt.current.get(sid);
				turnStartAt.current.delete(sid);
				const turnNo = (entries[sid]?.messages ?? []).filter((m) => m.kind === "user").length;
				void getPi()
					.checkpointCreate({
						sessionId: sid,
						cwd: meta.cwd,
						message: `turn:${turnNo}`,
						since,
					})
					.then(() => useCheckpointsStore.getState().bump())
					.catch(() => {});
			}
		}
	}, [activeKey, sessions]);
}
