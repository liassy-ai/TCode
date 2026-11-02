export const SIDEBAR_GROUP_INITIAL_ROWS = 6;

export const SIDEBAR_GROUP_MORE_STEP = 16;

export type MoreClicksMap = Readonly<Record<string, number>>;

export const EMPTY_MORE_CLICKS: MoreClicksMap = {};

function normalizeCount(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function visibleSessionCount(total: number, moreClicks: number): number {
	const rows = SIDEBAR_GROUP_INITIAL_ROWS + SIDEBAR_GROUP_MORE_STEP * normalizeCount(moreClicks);
	return Math.min(normalizeCount(total), rows);
}

export function visibleSessions<T>(sessions: readonly T[], moreClicks: number): T[] {
	return sessions.slice(0, visibleSessionCount(sessions.length, moreClicks));
}

export function hasMoreSessions(total: number, moreClicks: number): boolean {
	return visibleSessionCount(total, moreClicks) < normalizeCount(total);
}

export function bumpMoreClicks(map: MoreClicksMap, key: string): MoreClicksMap {
	return { ...map, [key]: normalizeCount(map[key] ?? 0) + 1 };
}

export function clearMoreClicks(map: MoreClicksMap, key: string): MoreClicksMap {
	if (!(key in map)) return map;
	const next: Record<string, number> = { ...map };
	delete next[key];
	return next;
}
