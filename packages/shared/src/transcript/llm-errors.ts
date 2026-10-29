import { buildLlmUiError, isUserAbortError, type UiError } from "../errors";

interface AssistantRoundLike {
	role?: unknown;
	stopReason?: unknown;
	errorMessage?: unknown;
}

export function isLlmErrorRound(m: AssistantRoundLike): m is {
	role: "assistant";
	stopReason: "error";
	errorMessage: string;
} {
	return (
		m?.role === "assistant" &&
		m.stopReason === "error" &&
		typeof m.errorMessage === "string" &&
		m.errorMessage.length > 0 &&
		!isUserAbortError(m.errorMessage)
	);
}

export function buildRoundErrorCard(m: { errorMessage: string }, timestamp?: number): UiError {
	return buildLlmUiError(m.errorMessage, timestamp);
}
