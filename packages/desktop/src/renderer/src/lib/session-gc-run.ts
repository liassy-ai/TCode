import { pickUnloadCandidates, type SessionGcEntry, type SessionGcOpen } from "./session-gc";

export interface SessionGcRoundDeps {
	getOpen: () => { activeSessionId: string | null; open: SessionGcOpen[] };

	entryOf: (sessionId: string) => SessionGcEntry | undefined;

	listSubscriptionSessionIds: () => Promise<string[]>;

	unload: (sessionId: string) => Promise<{ closed: boolean }>;
	now: number;
	keep?: number;

	log?: (message: string, ...args: unknown[]) => void;
}

export interface SessionGcRoundResult {
	skipped: "subscription-snapshot-failed" | null;

	unloaded: string[];

	refused: string[];
}

const defaultLog = (message: string, ...args: unknown[]): void => {
	if (import.meta.env.DEV) console.debug(message, ...args);
};

export async function runSessionGcRound(deps: SessionGcRoundDeps): Promise<SessionGcRoundResult> {
	const log = deps.log ?? defaultLog;
	let subscribedIds: Set<string>;
	try {
		subscribedIds = new Set(await deps.listSubscriptionSessionIds());
	} catch (error) {
		log("[session-gc] 跳过本轮：频道订阅快照获取失败", error);
		return { skipped: "subscription-snapshot-failed", unloaded: [], refused: [] };
	}

	const state = deps.getOpen();
	const candidates = pickUnloadCandidates({
		activeSessionId: state.activeSessionId,
		open: state.open.map((item) => ({
			...item,
			hasChannelSubscriptions: subscribedIds.has(item.sessionId),
		})),
		entryOf: deps.entryOf,
		now: deps.now,
		keep: deps.keep,
	});

	const unloaded: string[] = [];
	const refused: string[] = [];
	for (const { sessionId, reason } of candidates) {
		const latest = deps.getOpen();
		if (latest.activeSessionId === sessionId) continue;
		if (!latest.open.some((item) => item.sessionId === sessionId)) continue;
		const { closed } = await deps.unload(sessionId);
		if (closed) {
			unloaded.push(sessionId);
			log("[session-gc] unload", sessionId, `reason=${reason}`);
		} else {
			refused.push(sessionId);
			log("[session-gc] skipped", sessionId, `reason=${reason} refused-by-backend`);
		}
	}
	return { skipped: null, unloaded, refused };
}
