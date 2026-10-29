import { parseSessionEntries, type SessionEntry, type SessionManager } from "@earendil-works/pi-coding-agent";
import {
	AGENT_MESSAGE_CUSTOM_TYPE,
	extractSubagentRuns,
	type ImageInput,
	parseExpandedSkillInvocation,
	type SessionAssistantMessage,
	type SessionMessage,
	type SessionModelUsage,
	type SessionToolCall,
	SUB_CALL_MATERIALIZE,
} from "@tcode/shared";

export interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
	data?: string;
	mimeType?: string;
}

export interface RawMessage {
	role: string;
	content?: string | ContentBlock[];
	toolCallId?: string;
	isError?: boolean;
	timestamp?: number;

	details?: unknown;

	toolName?: string;

	customType?: string;

	stopReason?: string;

	errorMessage?: string;

	summary?: string;

	tokensBefore?: number;
}

function showImageFromDetails(details: unknown): { images: ImageInput[]; paths: string[] } | null {
	const d = details as { paths?: unknown; images?: unknown; path?: unknown; image?: unknown } | undefined;
	const toImage = (raw: unknown): ImageInput | null => {
		const img = raw as { data?: unknown; mimeType?: unknown } | undefined;
		if (typeof img?.data !== "string" || typeof img?.mimeType !== "string") return null;
		return { data: img.data, mimeType: img.mimeType };
	};
	if (Array.isArray(d?.images)) {
		const images = d.images.map(toImage).filter((img): img is ImageInput => img !== null);
		if (images.length === 0) return null;
		const paths = Array.isArray(d?.paths) ? d.paths.filter((p): p is string => typeof p === "string") : [];
		return { images, paths };
	}
	const legacy = toImage(d?.image);
	if (!legacy) return null;
	return { images: [legacy], paths: typeof d?.path === "string" ? [d.path] : [] };
}

export function blockText(content: string | ContentBlock[] | undefined): string {
	if (typeof content === "string") return content;
	return (content ?? [])
		.filter((c) => c.type === "text" && c.text)
		.map((c) => c.text ?? "")
		.join("");
}

export function blockThinking(content: ContentBlock[] | undefined): string {
	return (content ?? [])
		.filter((c) => c.type === "thinking" && c.thinking)
		.map((c) => c.thinking ?? "")
		.join("");
}

export function blockToolCalls(
	content: ContentBlock[] | undefined,
): Array<{ tool: SessionToolCall; index: number }> {
	return (content ?? [])
		.map((c, index) => ({ c, index }))
		.filter(({ c }) => c.type === "toolCall" && c.id)
		.map(({ c, index }) => ({
			tool: {
				id: c.id ?? "",
				name: c.name ?? "tool",
				args: JSON.stringify(c.arguments ?? {}),
				output: "",
				isError: false,
			},
			index,
		}));
}

export function runCodeSubCallRows(details: unknown): SessionToolCall[] | null {
	const list = (details as { subCalls?: unknown } | undefined)?.subCalls;
	if (!Array.isArray(list)) return null;
	const rows: SessionToolCall[] = [];
	for (const entry of list) {
		const item = entry as { id?: unknown; tool?: unknown; ok?: unknown; args?: unknown; error?: unknown };
		if (typeof item.id !== "string" || typeof item.tool !== "string") continue;
		rows.push({
			id: item.id,
			name: item.tool,
			args: typeof item.args === "string" ? item.args : "",
			output: typeof item.error === "string" ? item.error : "",
			isError: item.ok === false,
		});
	}
	return rows.length > 0 ? rows : null;
}

export function blockImages(content: string | ContentBlock[] | undefined): ImageInput[] {
	if (typeof content === "string") return [];
	return (content ?? [])
		.filter((c) => c.type === "image" && c.data)
		.map((c) => ({ data: c.data as string, mimeType: (c.mimeType as string) ?? "image/png" }));
}

export function resolveRecallEntryId(
	sm: Pick<SessionManager, "getEntry" | "getBranch">,
	ref: { entryId?: string; text?: string; timestamp?: number },
): string {
	if (ref.entryId) {
		const e = sm.getEntry(ref.entryId);
		if (!e) throw new Error("Recall target message not found");
		if (e.type !== "message" || (e.message as RawMessage).role !== "user") {
			throw new Error("Recall target is not a user message");
		}
		return ref.entryId;
	}
	if (ref.text !== undefined || ref.timestamp !== undefined) {
		const branch = sm.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const e = branch[i];
			if (e?.type !== "message") continue;
			const m = e.message as RawMessage;
			if (m.role !== "user") continue;

			if (ref.timestamp !== undefined && m.timestamp !== ref.timestamp) continue;
			if (ref.text !== undefined && blockText(m.content) !== ref.text) continue;
			return e.id;
		}
	}
	throw new Error("Recall target message not found");
}

export function resolveForkEntryId(
	sm: Pick<SessionManager, "getEntry" | "getBranch">,
	ref: { entryId?: string; text?: string },
): string {
	if (ref.entryId) {
		const e = sm.getEntry(ref.entryId);
		if (e) {
			if (e.type !== "message" || (e.message as RawMessage).role !== "assistant") {
				throw new Error("Fork target is not an assistant message");
			}
			return ref.entryId;
		}
	}
	if (ref.text) {
		const branch = sm.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const e = branch[i];
			if (e?.type !== "message") continue;
			const m = e.message as RawMessage;
			if (m.role !== "assistant") continue;
			if (blockText(m.content) === ref.text) return e.id;
		}
	}
	throw new Error("Fork target message not found");
}

export function readSessionMessagesFromContent(content: string): SessionMessage[] {
	const entries = parseSessionEntries(content);

	const byId = new Map<string, (typeof entries)[number]>();
	for (const entry of entries) {
		if (entry.type !== "session") byId.set(entry.id, entry);
	}
	const branch: SessionEntry[] = [];
	let cursor = entries.length > 0 ? entries[entries.length - 1] : null;
	while (cursor && cursor.type !== "session") {
		branch.unshift(cursor);
		cursor = cursor.parentId ? (byId.get(cursor.parentId) ?? null) : null;
	}
	return toBranchSessionMessages(branch);
}

export function readModelUsageFromContent(content: string): SessionModelUsage[] {
	const entries = parseSessionEntries(content);
	const byId = new Map<string, (typeof entries)[number]>();
	for (const entry of entries) {
		if (entry.type !== "session") byId.set(entry.id, entry);
	}
	const branch: SessionEntry[] = [];
	let cursor = entries.length > 0 ? entries[entries.length - 1] : null;
	while (cursor && cursor.type !== "session") {
		branch.unshift(cursor);
		cursor = cursor.parentId ? (byId.get(cursor.parentId) ?? null) : null;
	}
	const byModel = new Map<string, SessionModelUsage>();
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message as {
			role?: string;
			model?: string;
			usage?: {
				input?: number;
				output?: number;
				cacheRead?: number;
				cacheWrite?: number;
				cost?: { total?: number };
			};
		};
		if (message.role !== "assistant" || !message.usage) continue;
		const key = message.model ?? "(unknown)";
		const acc = byModel.get(key) ?? {
			model: key,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			cost: 0,
		};
		acc.inputTokens += message.usage.input ?? 0;
		acc.outputTokens += message.usage.output ?? 0;
		acc.cacheReadTokens += message.usage.cacheRead ?? 0;
		acc.cacheWriteTokens += message.usage.cacheWrite ?? 0;
		acc.cost += message.usage.cost?.total ?? 0;
		byModel.set(key, acc);
	}
	return [...byModel.values()];
}

export function toBranchSessionMessages(branch: readonly SessionEntry[]): SessionMessage[] {
	const raw: unknown[] = [];
	for (const entry of branch) {
		if (entry.type === "message") raw.push(entry.message);
		else if (entry.type === "custom" && entry.customType === AGENT_MESSAGE_CUSTOM_TYPE) {
			const data = (entry.data ?? {}) as { agent?: unknown; text?: unknown; sessionFile?: unknown };
			const parsed = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
			raw.push({
				role: "agent",
				agent: typeof data.agent === "string" ? data.agent : "",
				text: typeof data.text === "string" ? data.text : "",
				timestamp: Number.isNaN(parsed) ? Date.now() : parsed,
				...(typeof data.sessionFile === "string" ? { sessionFile: data.sessionFile } : {}),
			});
		} else if (entry.type === "compaction") raw.push(compactionMarker(entry));
	}
	const messages = toSessionMessages(raw);
	assignEntryIds(messages, branch);
	return messages;
}

function compactionMarker(entry: Extract<SessionEntry, { type: "compaction" }>): RawMessage {
	const parsed = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
	return {
		role: "compaction",
		timestamp: Number.isNaN(parsed) ? Date.now() : parsed,
		...(entry.summary ? { summary: entry.summary } : {}),
		...(typeof entry.tokensBefore === "number" ? { tokensBefore: entry.tokensBefore } : {}),
	};
}

export function toSessionMessages(rawMessages: readonly unknown[]): SessionMessage[] {
	const out: SessionMessage[] = [];
	const toolById = new Map<string, SessionToolCall>();

	const messageByToolId = new Map<string, SessionAssistantMessage>();
	for (const raw of rawMessages as RawMessage[]) {
		const looseAgent = raw as {
			role?: string;
			agent?: unknown;
			text?: unknown;
			timestamp?: unknown;
			sessionFile?: unknown;
		};
		if (looseAgent.role === "agent") {
			const agentText = typeof looseAgent.text === "string" ? looseAgent.text : "";
			if (agentText.trim()) {
				out.push({
					role: "agent",
					agent: typeof looseAgent.agent === "string" ? looseAgent.agent : "",
					text: agentText,
					timestamp: typeof looseAgent.timestamp === "number" ? looseAgent.timestamp : Date.now(),
					...(typeof looseAgent.sessionFile === "string" ? { sessionFile: looseAgent.sessionFile } : {}),
				});
			}
			continue;
		}
		if (raw.role === "compaction") {
			out.push({
				role: "compaction",
				timestamp: raw.timestamp ?? Date.now(),
				...(raw.summary ? { summary: raw.summary } : {}),
				...(typeof raw.tokensBefore === "number" ? { tokensBefore: raw.tokensBefore } : {}),
			});
			continue;
		}
		if (raw.role === "user") {
			const sourceText = blockText(raw.content);
			const invocation = parseExpandedSkillInvocation(sourceText);
			out.push({
				role: "user",
				text: invocation ? (invocation.args ?? "") : sourceText,
				thinking: "",
				tools: [],
				images: blockImages(raw.content),
				timestamp: raw.timestamp ?? Date.now(),
				...(invocation ? { skill: { name: invocation.name, args: invocation.args }, sourceText } : {}),
			});
			continue;
		}
		if (raw.role === "assistant") {
			const content = Array.isArray(raw.content) ? raw.content : [];
			const toolBlocks = blockToolCalls(content);
			const tools = toolBlocks.map((b) => b.tool);
			for (const tool of tools) toolById.set(tool.id, tool);
			const text = blockText(raw.content);

			const textIndex = content.findIndex((c) => c?.type === "text" && c.text);
			const postBlocks = text && textIndex >= 0 ? toolBlocks.filter((b) => b.index > textIndex) : [];
			if (postBlocks.length > 0) {
				const preTools = toolBlocks.filter((b) => b.index < textIndex).map((b) => b.tool);
				const timestamp = raw.timestamp ?? Date.now();
				if (text || preTools.length > 0) {
					const pre: SessionMessage = {
						role: "assistant",
						text,
						thinking: blockThinking(content),
						tools: preTools,
						images: [],
						timestamp,
					};
					for (const t of pre.tools) messageByToolId.set(t.id, pre);
					out.push(pre);
				}
				const post: SessionMessage = {
					role: "assistant",
					text: "",
					thinking: "",
					tools: postBlocks.map((b) => b.tool),
					images: [],
					timestamp,
				};
				for (const t of post.tools) messageByToolId.set(t.id, post);
				out.push(post);
				continue;
			}
			const message: SessionMessage = {
				role: "assistant",
				text,
				thinking: blockThinking(content),
				tools,
				images: [],
				timestamp: raw.timestamp ?? Date.now(),
				...(raw.stopReason ? { stopReason: raw.stopReason } : {}),
				...(typeof raw.errorMessage === "string" && raw.errorMessage.length > 0
					? { errorMessage: raw.errorMessage }
					: {}),
			};

			if (message.text || message.thinking || message.tools.length > 0 || message.stopReason === "error") {
				for (const t of message.tools) messageByToolId.set(t.id, message);
				out.push(message);
			}
			continue;
		}
		if (raw.role === "toolResult") {
			const tool = raw.toolCallId ? toolById.get(raw.toolCallId) : undefined;
			if (tool) {
				tool.output = blockText(raw.content);
				tool.isError = raw.isError === true;

				if (typeof raw.timestamp === "number") tool.endedAt = raw.timestamp;

				if (tool.name === "edit" && !tool.isError) {
					const patch = (raw.details as { patch?: unknown } | undefined)?.patch;
					if (typeof patch === "string" && patch.length > 0) tool.diff = patch;
				}

				if (tool.name === "show_image" && !tool.isError) {
					const shown = showImageFromDetails(raw.details);
					if (shown) {
						out.push({
							role: "image",
							images: shown.images,
							paths: shown.paths,
							timestamp: raw.timestamp ?? Date.now(),
						});
					}
				}

				if (!tool.isError) {
					const runs = extractSubagentRuns(raw.details);
					if (runs) {
						out.push({
							role: "subagent",
							runs,
							timestamp: raw.timestamp ?? Date.now(),
						});
					}
				}

				if (tool.name === "run_code") {
					const subs = runCodeSubCallRows(raw.details);
					const owner = raw.toolCallId ? messageByToolId.get(raw.toolCallId) : undefined;
					if (subs && owner) {
						const index = owner.tools.indexOf(tool);

						tool.subCallTotal = subs.length;
						owner.tools.splice(
							index >= 0 ? index + 1 : owner.tools.length,
							0,
							...subs.slice(0, SUB_CALL_MATERIALIZE),
						);
					}
				}
			}
		}
	}
	return out;
}

export function assignEntryIds(messages: SessionMessage[], branch: readonly SessionEntry[]): void {
	const assistantByTimestamp = new Map<number, string[]>();
	const userByTimestamp = new Map<number, string[]>();
	for (const e of branch) {
		if (e.type !== "message") continue;
		const m = e.message as RawMessage;
		if (typeof m.timestamp !== "number") continue;
		const table = m.role === "assistant" ? assistantByTimestamp : m.role === "user" ? userByTimestamp : null;
		if (!table) continue;
		const queue = table.get(m.timestamp);
		if (queue) queue.push(e.id);
		else table.set(m.timestamp, [e.id]);
	}
	for (const message of messages) {
		if (message.role === "assistant") {
			if (!message.text) continue;
			const id = assistantByTimestamp.get(message.timestamp)?.shift();
			if (id) message.entryId = id;
			continue;
		}
		if (message.role === "user") {
			const id = userByTimestamp.get(message.timestamp)?.shift();
			if (id) message.entryId = id;
		}
	}
}
