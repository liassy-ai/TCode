import { statSync } from "node:fs";
import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";

export interface SessionTimes {
	createdAt: number;
	modifiedAt: number;
}

export function deriveSessionTimes(
	header: SessionHeader | null | undefined,
	entries: readonly SessionEntry[],
): SessionTimes | null {
	const createdAt = parseTimestamp(header?.timestamp);
	if (createdAt === undefined) return null;
	let latest: number | undefined;
	for (const entry of entries) {
		const activity = messageActivityTime(entry);
		if (activity === undefined || activity <= 0) continue;
		latest = latest === undefined ? activity : Math.max(latest, activity);
	}
	return { createdAt, modifiedAt: latest ?? createdAt };
}

function messageActivityTime(entry: SessionEntry): number | undefined {
	if (entry.type !== "message") return undefined;
	const message = entry.message as { role?: unknown; timestamp?: unknown } | undefined;
	if (message?.role !== "user" && message?.role !== "assistant") return undefined;
	if (typeof message.timestamp === "number") return message.timestamp;
	return parseTimestamp(entry.timestamp);
}

function parseTimestamp(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

export function fallbackSessionTimes(sessionFile: string | undefined): SessionTimes {
	const time = fileTimeFallback(sessionFile);
	return { createdAt: time, modifiedAt: time };
}

function fileTimeFallback(sessionFile: string | undefined): number {
	if (!sessionFile) return Date.now();
	try {
		return statSync(sessionFile).mtimeMs;
	} catch {
		return Date.now();
	}
}
