import { buildLlmUiError, classifyLlmError, DETAIL_MAX_LENGTH, type UiError } from "@tcode/shared";

export function buildSendUiError(message: string, now: number = Date.now()): UiError {
	const lower = message.toLowerCase();
	if (lower.includes("read-only")) {
		return {
			severity: "error",
			source: "session",
			titleKey: "error.title.sendReadOnly",
			detail: truncateDetail(message),
			actions: ["copyDetail"],
			timestamp: now,
		};
	}
	const cls = classifyLlmError(message);
	const base = buildLlmUiError(message, now);
	return {
		...base,
		titleKey: cls.titleKey === "error.title.llmGeneric" ? "error.title.sendFailed" : cls.titleKey,
	};
}

function truncateDetail(detail: string): string {
	if (detail.length <= DETAIL_MAX_LENGTH) return detail;
	return `${[...detail].slice(0, DETAIL_MAX_LENGTH).join("")}\n…[已截断]`;
}
