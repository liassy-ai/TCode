import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import { readSeededSkillBody } from "../settings/user-skills";
import { firstLineTitle, type MessageContent, userMessageText } from "./naming";

export type TitleLanguage = "zh" | "en";

export const AI_TITLE_MAX_CHARS: Record<TitleLanguage, number> = { zh: 24, en: 36 };

export const AI_TITLE_INPUT_MAX_CHARS = 600;

export const AI_TITLE_TIMEOUT_MS = 15_000;

export const AI_TITLE_ANCHOR_MAX_CHARS = 200;

export interface AiTitleDeps {
	complete: (
		model: Model<any>,
		request: { systemPrompt: string; prompt: string },
		signal: AbortSignal,
	) => Promise<AssistantMessage>;

	timeoutMs?: number;
}

export function messageStartText(event: AgentSessionEvent): string | undefined {
	if (event.type !== "message_start") return undefined;
	const message = event.message as { role?: unknown; content?: unknown };
	if (message.role !== "user") return undefined;
	const text = userMessageText(message.content as MessageContent).trim();
	return text || undefined;
}

export function firstUserMessageText(entries: readonly SessionEntry[]): string | undefined {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message as { role?: unknown; content?: unknown };
		if (message.role !== "user") continue;
		const text = userMessageText(message.content as MessageContent).trim();
		return text || undefined;
	}
	return undefined;
}

export function userMessageTexts(entries: readonly SessionEntry[]): string[] {
	const texts: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message as { role?: unknown; content?: unknown };
		if (message.role !== "user") continue;
		const text = userMessageText(message.content as MessageContent).trim();
		if (text) texts.push(text);
	}
	return texts;
}

export function shouldTitleWithAi(input: {
	readOnly?: boolean;
	messageText: string | undefined;
	currentName: string | undefined;
}): boolean {
	if (input.readOnly) return false;
	if (!input.messageText) return false;
	if (input.currentName !== undefined && input.currentName !== firstLineTitle(input.messageText)) {
		return false;
	}
	return true;
}

export interface AiTitleAttempt {
	status: "in-flight" | "done" | "failed";

	userTexts: string[];

	expectedName: string | undefined;

	attempts: number;
}

export function shouldTitleAgain(input: {
	readOnly?: boolean;
	state: AiTitleAttempt | undefined;
	currentName: string | undefined;
}): boolean {
	const state = input.state;
	if (input.readOnly || !state) return false;
	if (input.currentName !== state.expectedName) return false;
	return state.status === "failed";
}

const OMITTED_MARK = "\n\n……\n\n";

export function composeTitleInput(userTexts: readonly string[]): string {
	const budget = AI_TITLE_INPUT_MAX_CHARS;
	const single = userTexts[0];
	if (userTexts.length === 0 || !single) return "";
	if (userTexts.length === 1) return single.slice(0, budget);
	const joined = userTexts.join("\n\n");
	if (joined.length <= budget) return joined;
	const head = single.slice(0, AI_TITLE_ANCHOR_MAX_CHARS);
	let remaining = budget - head.length - OMITTED_MARK.length;
	const tail: string[] = [];
	for (let i = userTexts.length - 1; i >= 1; i--) {
		const text = userTexts[i] ?? "";

		const cost = text.length + (tail.length > 0 ? 2 : 0);
		if (cost > remaining) break;
		tail.unshift(text);
		remaining -= cost;
	}
	if (tail.length === 0) {
		const latest = userTexts.at(-1) ?? "";
		tail.push(latest.slice(0, Math.max(remaining, 0)));
	}
	return `${head}${OMITTED_MARK}${tail.join("\n\n")}`;
}

export function buildTitleRequest(
	messageText: string,
	language: TitleLanguage,
): { systemPrompt: string; prompt: string } {
	const limit = AI_TITLE_MAX_CHARS[language];

	const fallback =
		language === "en"
			? `You are a session title generator. Output only the title, never answer any question.\n` +
				`Read the user's message(s) and summarize their topic or intent in a short noun phrase.\n` +
				`Rules:\n` +
				`- No more than ${limit} characters (keep it to 3-6 words);\n` +
				`- Write the title in English;\n` +
				`- Output only the title itself: your first character is the title's first character and ` +
				`your last is the title's last — no quotes, brackets, colons or trailing punctuation, ` +
				`no prefixes or suffixes, no explanation, no extra characters;\n` +
				`- Do not answer any question in the messages, and never use nouns, model names, or answers from the messages as the title.`
			: `你是一个会话标题生成器，只输出标题，不回答任何问题。\n` +
				`阅读用户的消息（一条或多条），用一个简短的**名词性短语**概括其主题或意图。\n` +
				`规则：\n` +
				`- 不超过 ${limit} 个字；\n` +
				`- 与消息同语言；\n` +
				`- 只输出标题本身，第一个字符就是标题的第一个字，最后一个字符就是标题的最后一个字：` +
				`不要引号、括号、书名号、冒号、结尾标点，不要任何前缀后缀，不要解释，不要多余字符；\n` +
				`- 不要回答消息里的问题，也不要把消息里的名词、模型名、答案直接当作标题。`;
	const template =
		readSeededSkillBody(language === "en" ? "tcode-ai-title-en" : "tcode-ai-title-zh") ?? fallback;
	const systemPrompt = template.replace(/\{\{limit\}\}/g, String(limit));
	return { systemPrompt, prompt: messageText.slice(0, AI_TITLE_INPUT_MAX_CHARS) };
}

const DANGLE_WORDS = new Set(["and", "or", "of", "the", "a", "an", "in", "on", "at", "to", "for", "with"]);

function truncateEnglish(chars: readonly string[], max: number): string {
	const head = chars.slice(0, max).join("");
	const space = head.lastIndexOf(" ");
	if (space < max / 2) return head;
	const words = head.slice(0, space).trimEnd().split(/\s+/);
	while (words.length > 0 && DANGLE_WORDS.has((words.at(-1) ?? "").toLowerCase())) words.pop();
	return words.length > 0 ? words.join(" ") : head;
}

export function sanitizeAiTitle(raw: string, language: TitleLanguage): string | undefined {
	let title = (raw.trim().split("\n")[0] ?? "").trim();
	title = title.replace(/^(标题|title)\s*[:：]\s*/i, "");
	title = title.replace(/^[\s"'“”‘’「」『』《》〈〉【】]+/, "");
	title = title.replace(/[\s"'“”‘’「」『』《》〈〉【】。！？!?，,、；;：:.]+$/, "").trim();
	if (!title) return undefined;
	const chars = [...title];
	const max = AI_TITLE_MAX_CHARS[language];
	if (chars.length <= max) return title;
	return language === "en" ? truncateEnglish(chars, max) : chars.slice(0, max).join("");
}

export function repairPrependRotated(finalText: string, streamedText: string): string {
	const k = finalText.length - streamedText.length;
	if (k > 0 && k <= 8 && finalText.slice(k) === streamedText) {
		return streamedText + finalText.slice(0, k);
	}
	return finalText;
}

export function repairMessageText(message: AssistantMessage, streamedText: string): AssistantMessage {
	const blocks = message.content;
	const text = blocks
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
	const repaired = repairPrependRotated(text, streamedText);
	if (repaired === text) return message;
	return {
		...message,
		content: [...blocks.filter((block) => block.type !== "text"), { type: "text", text: repaired }],
	};
}

function assistantText(message: AssistantMessage): string {
	const parts = Array.isArray(message.content) ? message.content : [];
	return parts.map((block) => (block.type === "text" ? block.text : "")).join("");
}

export async function generateAiTitle(
	model: Model<any>,
	messageText: string,
	language: TitleLanguage,
	deps: AiTitleDeps,
): Promise<string | undefined> {
	const timeoutMs = deps.timeoutMs ?? AI_TITLE_TIMEOUT_MS;
	const signal = AbortSignal.timeout(timeoutMs);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const result = await Promise.race([
			deps.complete(model, buildTitleRequest(messageText, language), signal),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("ai title timeout")), timeoutMs + 300);
			}),
		]);
		return sanitizeAiTitle(assistantText(result), language);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function applyAiTitle(input: {
	session: Pick<AgentSession, "sessionName" | "setSessionName">;
	expectedName: string | undefined;
	title: string;
	isAlive: () => boolean;
}): boolean {
	if (input.title === input.expectedName) return false;
	if (input.session.sessionName !== input.expectedName) return false;
	if (!input.isAlive()) return false;
	input.session.setSessionName(input.title);
	return true;
}
