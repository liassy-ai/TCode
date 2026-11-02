import type { SessionEvent } from "@tcode/shared";

export function slimMessageUpdate(event: SessionEvent): SessionEvent {
	if (event.type !== "message_update") return event;
	const slim = slimAssistantMessageEvent(
		(event as { assistantMessageEvent?: unknown }).assistantMessageEvent,
	);

	return { type: "message_update", assistantMessageEvent: slim } as unknown as SessionEvent;
}

function slimAssistantMessageEvent(e: unknown): Record<string, unknown> {
	const ev = e as {
		type?: unknown;
		contentIndex?: unknown;
		delta?: unknown;
		partial?: unknown;
		toolCall?: unknown;
	};
	switch (ev?.type) {
		case "text_delta":
		case "thinking_delta":
		case "toolcall_delta":
			return { type: ev.type, contentIndex: ev.contentIndex, delta: ev.delta };
		case "toolcall_start":
			return { type: ev.type, contentIndex: ev.contentIndex, partial: ev.partial };
		case "toolcall_end":
			return { type: ev.type, contentIndex: ev.contentIndex, toolCall: ev.toolCall };
		default:
			return ev && typeof ev.type === "string" ? { type: ev.type } : {};
	}
}

const TEXT_TRUNCATE_AT = 16 * 1024;
const TEXT_KEEP_HEAD = 4 * 1024;

const IMAGE_DATA_STRIP_AT = 512;

export function slimBulkyEvent(event: SessionEvent): SessionEvent {
	switch (event.type) {
		case "tool_execution_end":
			return replace(event, "result", slimToolResult((event as { result?: unknown }).result));
		case "message_start":
		case "message_end": {
			const message = (event as { message?: unknown }).message;
			if ((message as { role?: unknown } | undefined)?.role !== "toolResult") return event;
			return replace(event, "message", slimToolResult(message));
		}
		case "turn_end": {
			const toolResults = (event as { toolResults?: unknown[] }).toolResults;
			if (!Array.isArray(toolResults)) return event;
			let changed = false;
			const next = toolResults.map((r) => {
				const slim = slimToolResult(r);
				if (slim !== r) changed = true;
				return slim;
			});
			return changed ? ({ ...event, toolResults: next } as SessionEvent) : event;
		}
		default:
			return event;
	}
}

function replace<T extends object, K extends string>(obj: T, key: K, value: unknown): T {
	return (obj as Record<string, unknown>)[key] === value ? obj : ({ ...obj, [key]: value } as T);
}

function slimToolResult(r: unknown): unknown {
	if (!r || typeof r !== "object") return r;
	const content = (r as { content?: unknown }).content;
	if (!Array.isArray(content)) return r;
	let changed = false;
	const next = content.map((b) => {
		if (!b || typeof b !== "object") return b;
		const block = b as { type?: unknown; data?: unknown; text?: unknown };
		if (block.type === "image" && typeof block.data === "string" && block.data.length > IMAGE_DATA_STRIP_AT) {
			changed = true;
			return { ...block, data: `[image data stripped: ${block.data.length}B]` };
		}
		if (block.type === "text" && typeof block.text === "string" && block.text.length > TEXT_TRUNCATE_AT) {
			changed = true;
			const head = block.text.slice(0, TEXT_KEEP_HEAD);
			return { ...block, text: `${head}\n[tool output truncated: kept 4KB of ${block.text.length}B]` };
		}
		return b;
	});
	return changed ? ({ ...r, content: next } as object) : r;
}
