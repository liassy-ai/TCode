export type AskQuestion = { question?: string; options?: string[]; multiple?: boolean };

export const ASK_TOOL_NAMES = new Set(["ask_user", "questionnaire"]);

const ARGS_TRUNCATION_RE = /\s*\[\.\.\.[\s\S]*$/;

function extractQuestions(d: {
	questions?: AskQuestion[];
	question?: string;
	options?: string[];
	multiple?: boolean;
}): AskQuestion[] {
	if (Array.isArray(d.questions)) return d.questions;
	if (typeof d.question === "string" && d.question.trim())
		return [
			{
				question: d.question,
				...(d.options ? { options: d.options } : {}),
				...(d.multiple !== undefined ? { multiple: d.multiple } : {}),
			},
		];
	return [];
}

function closeTruncatedJson(prefix: string): string | null {
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	for (const ch of prefix) {
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") stack.push("}");
		else if (ch === "[") stack.push("]");
		else if (ch === "}" || ch === "]") stack.pop();
	}
	if (inString) return null;
	return prefix + stack.reverse().join("");
}

export function parseAskQuestions(args?: string): AskQuestion[] {
	if (!args) return [];
	const text = args.replace(ARGS_TRUNCATION_RE, "").trim();
	try {
		return extractQuestions(
			JSON.parse(text) as {
				questions?: AskQuestion[];
				question?: string;
				options?: string[];
				multiple?: boolean;
			},
		);
	} catch {
		const cut = text.lastIndexOf("}");
		if (cut < 0) return [];
		try {
			const repaired = closeTruncatedJson(text.slice(0, cut + 1));
			return repaired
				? extractQuestions(
						JSON.parse(repaired) as {
							questions?: AskQuestion[];
							question?: string;
							options?: string[];
							multiple?: boolean;
						},
					)
				: [];
		} catch {
			return [];
		}
	}
}

export function countAskQuestions(args?: string): number {
	const n = parseAskQuestions(args).length;
	return n > 0 ? n : 1;
}
