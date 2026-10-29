export interface ActivitySlot {
	id: string;
	kind: "tool" | "thinking";
}

export interface ActivityTickerSnapshot {
	currentId: string | null;

	switchAt: number | null;
}

export interface ActivityTicker {
	ingest(items: ActivitySlot[], now: number): ActivityTickerSnapshot;

	tick(now: number): ActivityTickerSnapshot;
	peek(): ActivityTickerSnapshot;
}

export const ACTIVITY_TICKER_DEFAULTS = {
	minDwellMs: 350,
};

export function createActivityTicker(options: Partial<typeof ACTIVITY_TICKER_DEFAULTS> = {}): ActivityTicker {
	const { minDwellMs } = { ...ACTIVITY_TICKER_DEFAULTS, ...options };

	let currentId: string | null = null;
	let shownAt = 0;
	let latestItems: ActivitySlot[] = [];

	const snapshot = (switchAt: number | null): ActivityTickerSnapshot => ({ currentId, switchAt });

	const switchTo = (id: string, now: number): void => {
		currentId = id;
		shownAt = now;
	};

	const ingest = (items: ActivitySlot[], now: number): ActivityTickerSnapshot => {
		latestItems = items;
		const latest = items[items.length - 1];
		if (!latest) {
			currentId = null;
			return snapshot(null);
		}
		if (latest.id === currentId) return snapshot(null);
		if (!currentId || now - shownAt >= minDwellMs) {
			switchTo(latest.id, now);
			return snapshot(null);
		}
		return snapshot(shownAt + minDwellMs);
	};

	const tick = (now: number): ActivityTickerSnapshot => {
		const latest = latestItems[latestItems.length - 1];
		if (latest && latest.id !== currentId) switchTo(latest.id, now);
		return snapshot(null);
	};

	return { ingest, tick, peek: () => snapshot(null) };
}
