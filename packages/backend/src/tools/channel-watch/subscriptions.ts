import { validateTopic } from "./init";

export const SUBSCRIPTION_CUSTOM_TYPE = "channel-subs";

export interface SubsPayload {
	topics: string[];
	cursors?: Record<string, string | null>;
}

export interface RestoredSubscriptions {
	topics: string[];
	cursors: Map<string, string | null>;
}

function isSafeTopic(topic: string): boolean {
	return typeof topic === "string" && validateTopic(topic) === null;
}

function isSafeCursor(value: unknown): value is string | null {
	return value === null || (typeof value === "string" && value.length > 0);
}

export function buildSubsPayload(
	topics: Iterable<string>,
	cursors?: ReadonlyMap<string, string | null>,
): SubsPayload {
	const safeTopics = [...new Set(topics)].filter(isSafeTopic).sort();
	if (!cursors) return { topics: safeTopics };
	const subscribed = new Set(safeTopics);
	const safeCursors: Record<string, string | null> = {};

	for (const topic of [...subscribed].sort()) {
		const value = cursors.get(topic);
		if (isSafeCursor(value)) safeCursors[topic] = value;
	}
	return { topics: safeTopics, cursors: safeCursors };
}

export function restoreSubscriptionState(entries: unknown): RestoredSubscriptions {
	let topics: string[] = [];
	let cursors = new Map<string, string | null>();
	try {
		if (!Array.isArray(entries)) return { topics, cursors };
		for (const entry of entries) {
			const e = entry as { type?: unknown; customType?: unknown; data?: unknown } | null | undefined;
			if (e?.type !== "custom" || e.customType !== SUBSCRIPTION_CUSTOM_TYPE) continue;
			const data = e.data as { topics?: unknown; cursors?: unknown } | null | undefined;
			const rawTopics = data?.topics;
			if (!Array.isArray(rawTopics)) continue;

			topics = [...new Set(rawTopics.filter((t): t is string => isSafeTopic(t as string)))];
			cursors = new Map();
			const rawCursors = data?.cursors;
			if (rawCursors && typeof rawCursors === "object" && !Array.isArray(rawCursors)) {
				const subscribed = new Set(topics);
				for (const [topic, value] of Object.entries(rawCursors as Record<string, unknown>)) {
					if (!subscribed.has(topic) || !isSafeCursor(value)) continue;
					cursors.set(topic, value);
				}
			}
		}
	} catch {}
	return { topics, cursors };
}

export function restoreSubscriptions(entries: unknown): Set<string> {
	return new Set(restoreSubscriptionState(entries).topics);
}
