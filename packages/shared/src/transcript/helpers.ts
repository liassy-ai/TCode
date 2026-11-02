import type { ImageInput } from "../session";
import type { ActivityEntry, StreamingState } from "./types";

let nextMessageId = 0;
export function newMessageId(): string {
	return `m${nextMessageId++}`;
}

let nextToolKey = 0;
export function newToolKey(): string {
	return `t${nextToolKey++}`;
}

let nextSubagentKey = 0;
export function newSubagentKey(): string {
	return `s${nextSubagentKey++}`;
}

export function emptyStreaming(): StreamingState {
	return {
		id: newMessageId(),
		startedAt: Date.now(),
		text: "",
		thinking: "",
		tools: [],
		pendingImages: [],
		subagentRuns: [],
		subagentByToolCallId: {},
		activeToolIndex: -1,
		toolByContentIndex: {},
		rawToolOutputs: {},
		activity: [],
		textBlockIndex: null,
	};
}

export function parseArgs(raw: unknown): string {
	if (typeof raw !== "string") return JSON.stringify(raw ?? {});
	try {
		const parsed = JSON.parse(raw);
		return JSON.stringify(parsed, null, 0);
	} catch {
		return raw;
	}
}

export function toolNameFromPartial(partial: unknown, contentIndex: number): string {
	const content = (partial as { content?: Array<{ type?: string; name?: string }> } | undefined)?.content;
	const block = content?.[contentIndex];
	if (block?.type === "toolCall" && block.name) return block.name;
	for (let i = contentIndex - 1; i >= 0; i--) {
		const prev = content?.[i];
		if (prev?.type === "toolCall" && prev.name) return prev.name;
	}
	return "tool";
}

export function updateThinkingActivity(
	activity: ActivityEntry[],
	contentIndex: number,
	append: (text: string) => string,
): ActivityEntry[] {
	const id = `h${contentIndex}`;
	const existing = activity.find((entry) => entry.id === id);
	if (!existing) return [...activity, { id, kind: "thinking", text: append("") }];
	return activity.map((entry) =>
		entry.id === id && entry.kind === "thinking" ? { ...entry, text: append(entry.text) } : entry,
	);
}

export function updateToolActivity(
	activity: ActivityEntry[],
	contentIndex: number,
	append: (args: string) => string,
): ActivityEntry[] {
	const id = `c${contentIndex}`;
	return activity.map((entry) =>
		entry.id === id && entry.kind === "tool" ? { ...entry, args: append(entry.args) } : entry,
	);
}

export function findLastIndex<T>(arr: readonly T[], predicate: (item: T) => boolean): number {
	for (let i = arr.length - 1; i >= 0; i--) {
		const item = arr[i];
		if (item && predicate(item)) return i;
	}
	return -1;
}

export function extractExecutionDelta(partialResult: unknown): string | null {
	if (partialResult == null) return null;
	if (typeof partialResult === "string") return partialResult;
	const partial = partialResult as Record<string, unknown>;
	const output = partial.output;
	if (typeof output === "string" && output.length > 0) return output;
	const text = partial.text;
	if (typeof text === "string" && text.length > 0) return text;
	return null;
}

export function extractResultText(result: unknown): string {
	if (result == null) return "";
	if (typeof result === "string") return result;
	const r = result as Record<string, unknown>;
	const content = r.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				const b = block as { type?: unknown; text?: unknown };
				return b?.type === "text" && typeof b.text === "string" ? b.text : "";
			})
			.join("");
	}
	if (typeof r.text === "string") return r.text;
	if (typeof r.output === "string") return r.output;
	return "";
}

export function extractShowImage(result: unknown): { images: ImageInput[]; paths: string[] } | null {
	const details = (result as { details?: unknown } | null | undefined)?.details;
	const d = details as { paths?: unknown; images?: unknown; path?: unknown; image?: unknown } | undefined;
	const toImage = (raw: unknown): ImageInput | null => {
		const img = raw as { data?: unknown; mimeType?: unknown } | undefined;
		if (typeof img?.data !== "string" || typeof img?.mimeType !== "string") return null;
		return { data: img.data, mimeType: img.mimeType };
	};
	const toPaths = (raw: unknown): string[] =>
		Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
	if (Array.isArray(d?.images)) {
		const images = d.images.map(toImage).filter((img): img is ImageInput => img !== null);
		return images.length > 0 ? { images, paths: toPaths(d.paths) } : null;
	}
	const legacy = toImage(d?.image);
	if (!legacy) return null;
	return { images: [legacy], paths: typeof d?.path === "string" ? [d.path] : [] };
}

export function extractEditPatch(result: unknown): string | null {
	const details = (result as { details?: unknown } | null | undefined)?.details;
	const patch = (details as { patch?: unknown } | undefined)?.patch;
	return typeof patch === "string" && patch.length > 0 ? patch : null;
}

interface AssistantContentBlock {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
}

export function extractAssistantContent(content: unknown): {
	text: string;
	thinking: string;
	firstTextIndex: number;
} {
	if (typeof content === "string") {
		return { text: content, thinking: "", firstTextIndex: content ? 0 : -1 };
	}
	const blocks = Array.isArray(content) ? (content as AssistantContentBlock[]) : [];
	let text = "";
	let thinking = "";
	let firstTextIndex = -1;
	blocks.forEach((block, index) => {
		if (block?.type === "text" && typeof block.text === "string" && block.text) {
			if (firstTextIndex < 0) firstTextIndex = index;
			text += block.text;
		} else if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
			thinking += block.thinking;
		}
	});
	return { text, thinking, firstTextIndex };
}
