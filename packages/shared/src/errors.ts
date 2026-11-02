export type UiErrorSeverity = "error" | "warning" | "info";

export type UiErrorSource = "llm" | "session" | "tool" | "extension" | "app" | "network";

export type UiErrorAction = "retry" | "compact" | "openSettings" | "copyDetail";

export interface UiError {
	severity: UiErrorSeverity;
	source: UiErrorSource;

	titleKey: string;
	titleParams?: Record<string, string | number>;

	detail?: string;

	hintKey?: string;

	actions: UiErrorAction[];
	timestamp: number;
}

export const DETAIL_MAX_LENGTH = 4096;

export function isUserAbortError(errorMessage: string): boolean {
	return /was aborted|request aborted/i.test(errorMessage);
}

export interface LlmErrorClass {
	titleKey: string;
	hintKey?: string;
	source: UiErrorSource;
	actions: UiErrorAction[];
}

function truncateDetail(detail: string): string {
	if (detail.length <= DETAIL_MAX_LENGTH) return detail;
	return `${[...detail].slice(0, DETAIL_MAX_LENGTH).join("")}\n…[已截断]`;
}

const LLM_ERROR_PATTERNS: ReadonlyArray<{ pattern: RegExp; cls: LlmErrorClass }> = [
	{
		pattern: /401|unauthorized|invalid\s+api\s+key|authentication/i,
		cls: {
			titleKey: "error.title.llmAuth",
			hintKey: "error.hint.checkApiKey",
			source: "llm",
			actions: ["retry", "openSettings", "copyDetail"],
		},
	},
	{
		pattern: /429|rate\s*limit|too\s+many\s*requests/i,
		cls: {
			titleKey: "error.title.llmRateLimit",
			hintKey: "error.hint.rateLimit",
			source: "llm",
			actions: ["retry", "copyDetail"],
		},
	},
	{
		pattern: /context_length|context\s+length|maximum\s+context|too\s+many\s+tokens/i,
		cls: {
			titleKey: "error.title.llmOverflow",
			hintKey: "error.hint.compact",
			source: "llm",
			actions: ["compact", "copyDetail"],
		},
	},
	{
		pattern: /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch\s+failed|\bnetwork\b|\btimeout\b/i,
		cls: {
			titleKey: "error.title.llmNetwork",
			hintKey: "error.hint.network",
			source: "network",
			actions: ["retry", "copyDetail"],
		},
	},
];

const LLM_ERROR_FALLBACK: LlmErrorClass = {
	titleKey: "error.title.llmGeneric",
	source: "llm",
	actions: ["retry", "copyDetail"],
};

export function classifyLlmError(errorMessage: string): LlmErrorClass {
	for (const { pattern, cls } of LLM_ERROR_PATTERNS) {
		if (pattern.test(errorMessage)) return cls;
	}
	return LLM_ERROR_FALLBACK;
}

export function buildLlmUiError(errorMessage: string, now: number = Date.now()): UiError {
	const cls = classifyLlmError(errorMessage);
	return {
		severity: "error",
		source: cls.source,
		titleKey: cls.titleKey,
		detail: truncateDetail(errorMessage),
		...(cls.hintKey ? { hintKey: cls.hintKey } : {}),
		actions: cls.actions.includes("copyDetail") ? cls.actions : [...cls.actions, "copyDetail"],
		timestamp: now,
	};
}

export function buildStreamGuardUiError(verdict: string, now: number = Date.now()): UiError {
	return {
		severity: "warning",
		source: "app",
		titleKey: "error.title.streamGuard",
		hintKey: "error.hint.streamGuard",
		detail: truncateDetail(`StreamGuard tripped: ${verdict}`),
		actions: ["retry", "copyDetail"],
		timestamp: now,
	};
}
