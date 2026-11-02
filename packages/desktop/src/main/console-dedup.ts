export interface ConsoleDedupSummary {
	signature: string;

	sinceLast: number;

	total: number;
}

export interface ConsoleDedupDecision {
	logFull: boolean;

	summary?: ConsoleDedupSummary;
}

export function consoleSignature(message: string, sourceId?: string): string {
	return `${message.slice(0, 200)}|${sourceId ?? ""}`;
}

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_THRESHOLD = 10;

export function createConsoleDeduper(options?: { maxEntries?: number; threshold?: number }) {
	const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
	const entries = new Map<string, { count: number; lastLoggedCount: number }>();

	return {
		observe(signature: string): ConsoleDedupDecision {
			const entry = entries.get(signature);
			if (!entry) {
				if (entries.size >= maxEntries) {
					const oldest = entries.keys().next().value;
					if (oldest !== undefined) entries.delete(oldest);
				}
				entries.set(signature, { count: 1, lastLoggedCount: 0 });
				return { logFull: true };
			}
			entry.count++;
			const sinceLast = entry.count - entry.lastLoggedCount;
			if (sinceLast < threshold) return { logFull: false };
			entry.lastLoggedCount = entry.count;
			return { logFull: false, summary: { signature, sinceLast, total: entry.count } };
		},

		flush(): ConsoleDedupSummary[] {
			const out: ConsoleDedupSummary[] = [];
			for (const [signature, entry] of entries) {
				const sinceLast = entry.count - entry.lastLoggedCount;
				if (sinceLast < 1) continue;
				entry.lastLoggedCount = entry.count;
				out.push({ signature, sinceLast, total: entry.count });
			}
			return out;
		},
	};
}

export function consoleDedupLogLine(
	s: ConsoleDedupSummary,
): [message: string, args: Record<string, unknown>] {
	return [
		"renderer console repeated",
		{ count: s.total, sinceLast: s.sinceLast, signature: s.signature.slice(0, 100) },
	];
}
