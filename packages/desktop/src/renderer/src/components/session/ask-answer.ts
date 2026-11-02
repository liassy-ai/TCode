export const ASK_ANSWER_SEPARATOR = "、";

export function composeAskAnswer(picks: string[], custom?: string): string {
	const parts: string[] = [];
	const text = (custom ?? "").trim();
	for (const part of [...picks, ...(text ? [text] : [])]) {
		const trimmed = part.trim();
		if (trimmed.length > 0 && !parts.includes(trimmed)) parts.push(trimmed);
	}
	return parts.join(ASK_ANSWER_SEPARATOR);
}
