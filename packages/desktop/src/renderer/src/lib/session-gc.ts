export interface SessionGcEntry {
	agentActive: boolean;

	pendingPermissions: unknown[];

	pendingDialogs: unknown[];

	unseenCompletion: boolean;

	compacting: boolean;

	followUpQueue: string[];

	messageCount: number;
}

export interface SessionGcOpen {
	sessionId: string;

	lastUsedAt: number;

	messageCount: number;

	hasChannelSubscriptions?: boolean;
}

export interface SessionGcInput {
	activeSessionId: string | null;

	open: SessionGcOpen[];

	entryOf: (sessionId: string) => SessionGcEntry | undefined;
	now: number;

	keep?: number;

	freshMs?: number;

	idleTimeoutMs?: number;
}

export interface UnloadCandidate {
	sessionId: string;
	reason: "over-limit" | "idle-timeout";
}

export const GC_DEFAULTS = {
	keep: 3,

	freshMs: 3_000,
	idleTimeoutMs: 300_000,
} as const;

export function isProtected(item: SessionGcOpen, entry: SessionGcEntry | undefined): boolean {
	if (item.hasChannelSubscriptions) return true;

	if (item.messageCount === 0 && (entry?.messageCount ?? 0) === 0) return true;

	if (!entry) return false;
	return (
		entry.agentActive ||
		entry.compacting ||
		entry.unseenCompletion ||
		entry.pendingPermissions.length > 0 ||
		entry.pendingDialogs.length > 0 ||
		entry.followUpQueue.length > 0
	);
}

export function pickUnloadCandidates(input: SessionGcInput): UnloadCandidate[] {
	const keep = input.keep ?? GC_DEFAULTS.keep;
	const freshMs = input.freshMs ?? GC_DEFAULTS.freshMs;
	const idleTimeoutMs = input.idleTimeoutMs ?? GC_DEFAULTS.idleTimeoutMs;

	const idle = input.open
		.filter(
			(item) =>
				item.sessionId !== input.activeSessionId &&
				!isProtected(item, input.entryOf(item.sessionId)) &&
				input.now - item.lastUsedAt > freshMs,
		)
		.sort((a, b) => a.lastUsedAt - b.lastUsedAt);

	const overLimitCount = Math.max(0, idle.length - Math.max(0, keep));
	return [
		...idle
			.slice(0, overLimitCount)
			.map((item): UnloadCandidate => ({ sessionId: item.sessionId, reason: "over-limit" })),

		...idle
			.slice(overLimitCount)
			.filter((item) => input.now - item.lastUsedAt > idleTimeoutMs)
			.map((item): UnloadCandidate => ({ sessionId: item.sessionId, reason: "idle-timeout" })),
	];
}
