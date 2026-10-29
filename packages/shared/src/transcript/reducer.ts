import { buildStreamGuardUiError, type UiError } from "../errors";
import type { ImageInput, SessionEvent } from "../session";
import { parseExpandedSkillInvocation } from "../skill-invocation";
import { extractSubagentRuns } from "../subagent";
import { extractTodos, TODO_TOOL_NAME } from "../todo";
import {
	emptyStreaming,
	extractAssistantContent,
	extractEditPatch,
	extractExecutionDelta,
	extractResultText,
	extractShowImage,
	findLastIndex,
	newMessageId,
	newToolKey,
	parseArgs,
	toolNameFromPartial,
	updateThinkingActivity,
	updateToolActivity,
} from "./helpers";
import { buildRoundErrorCard, isLlmErrorRound } from "./llm-errors";
import type {
	CompactionUiState,
	SessionTranscriptState,
	StreamingState,
	SubagentRunUi,
	UIMessage,
	UIToolCall,
} from "./types";

function appendMessage(state: SessionTranscriptState, message: UIMessage): SessionTranscriptState {
	return { ...state, messages: [...state.messages, message] };
}

function withStreaming(
	state: SessionTranscriptState,
	fn: (streaming: StreamingState) => StreamingState,
): SessionTranscriptState {
	if (!state.streaming) return state;
	const streaming = fn(state.streaming);
	if (streaming === state.streaming) return state;
	return { ...state, streaming };
}

function patchStreamingTool(
	tools: UIToolCall[],
	toolCallId: string,
	patch: (tool: UIToolCall) => UIToolCall,
): UIToolCall[] {
	return tools.map((t) => (t.id === toolCallId ? patch(t) : t));
}

function reconcileStreamingWithFinalMessage(
	state: SessionTranscriptState,
	message: unknown,
): SessionTranscriptState {
	const streaming = state.streaming;
	if (!streaming) return state;
	if ((message as { role?: unknown } | undefined)?.role !== "assistant") return state;
	const { text, thinking, firstTextIndex } = extractAssistantContent(
		(message as { content?: unknown }).content,
	);

	const needText = text.length > 0 && text !== streaming.text;
	const needThinking = thinking.length > 0 && thinking !== streaming.thinking;
	if (!needText && !needThinking) return state;
	return {
		...state,
		streaming: {
			...streaming,
			...(needText
				? { text, textBlockIndex: firstTextIndex >= 0 ? firstTextIndex : streaming.textBlockIndex }
				: {}),
			...(needThinking ? { thinking } : {}),
		},
	};
}

type AssistantStreamEvent = Extract<SessionEvent, { type: "message_update" }>["assistantMessageEvent"];

function applyAssistantMessageUpdate(streaming: StreamingState, e: AssistantStreamEvent): StreamingState {
	switch (e.type) {
		case "text_delta": {
			const text = streaming.text + e.delta;
			return {
				...streaming,
				text,

				textBlockIndex: text ? (streaming.textBlockIndex ?? e.contentIndex) : null,
			};
		}
		case "thinking_delta":
			return {
				...streaming,
				thinking: streaming.thinking + e.delta,
				activity: updateThinkingActivity(streaming.activity, e.contentIndex, (text) => text + e.delta),
			};
		case "toolcall_start": {
			const name = toolNameFromPartial(e.partial, e.contentIndex);
			const tools = [
				...streaming.tools,
				{
					key: newToolKey(),
					id: "",
					name,
					args: "",
					output: "",
					state: "running" as const,
					blockIndex: e.contentIndex,
				},
			];
			return {
				...streaming,
				tools,
				toolByContentIndex: {
					...streaming.toolByContentIndex,
					[e.contentIndex]: tools.length - 1,
				},
				activeToolIndex: tools.length - 1,
				activity: [
					...streaming.activity,
					{ id: `c${e.contentIndex}`, kind: "tool" as const, name, args: "" },
				],
			};
		}
		case "toolcall_delta": {
			const tools = [...streaming.tools];
			const idx =
				streaming.toolByContentIndex[e.contentIndex] ??
				(streaming.activeToolIndex >= 0 ? streaming.activeToolIndex : tools.length - 1);
			const tool = tools[idx];
			if (!tool) return streaming;
			tools[idx] = { ...tool, args: tool.args + e.delta };
			return {
				...streaming,
				tools,
				activity: updateToolActivity(streaming.activity, e.contentIndex, (a) => a + e.delta),
			};
		}
		case "toolcall_end": {
			const tools = [...streaming.tools];
			const idx =
				streaming.toolByContentIndex[e.contentIndex] ??
				(streaming.activeToolIndex >= 0 ? streaming.activeToolIndex : tools.length - 1);
			const target = idx >= 0 ? idx : tools.findIndex((t) => t.id === e.toolCall.id);
			const tool = tools[target];
			if (!tool) return streaming;
			const args = parseArgs(e.toolCall.arguments);
			tools[target] = {
				...tool,
				id: e.toolCall.id,
				name: e.toolCall.name || tool.name,
				args,
			};
			const activity = streaming.activity.map((entry) =>
				entry.id === `c${e.contentIndex}` && entry.kind === "tool"
					? { ...entry, name: e.toolCall.name || entry.name, args }
					: entry,
			);
			return { ...streaming, tools, activity, activeToolIndex: -1 };
		}
		default:
			return streaming;
	}
}

function insertByTime(messages: UIMessage[], group: UIMessage[], at: number): UIMessage[] {
	if (group.length === 0) return messages;
	let idx = messages.length;
	while (idx > 0) {
		const prev = messages[idx - 1];
		if (prev && typeof prev.timestamp === "number" && prev.timestamp > at) idx -= 1;
		else break;
	}
	if (idx === messages.length) return [...messages, ...group];
	return [...messages.slice(0, idx), ...group, ...messages.slice(idx)];
}

function finalizeStreaming(state: SessionTranscriptState): SessionTranscriptState {
	const { streaming, messages } = state;
	if (!streaming) return state;
	const at = streaming.startedAt;

	const subagents: UIMessage[] =
		streaming.subagentRuns.length > 0
			? [
					{
						kind: "subagent",
						id: newMessageId(),
						runs: streaming.subagentRuns,
						timestamp: at,
					},
				]
			: [];

	const images: UIMessage[] = streaming.pendingImages.map((img) => ({
		kind: "image",
		id: newMessageId(),
		images: img.images,
		paths: img.paths,
		timestamp: at,
	}));
	const hasContent = streaming.text.length > 0 || streaming.thinking.length > 0 || streaming.tools.length > 0;
	if (!hasContent) {
		return images.length > 0 || subagents.length > 0
			? { ...state, messages: insertByTime(messages, [...subagents, ...images], at), streaming: null }
			: { ...state, streaming: null };
	}

	const textIdx = streaming.textBlockIndex;
	const postTools = textIdx == null ? [] : streaming.tools.filter((t) => (t.blockIndex ?? 0) > textIdx);
	const preTools =
		textIdx == null ? streaming.tools : streaming.tools.filter((t) => (t.blockIndex ?? 0) < textIdx);
	const assistantMessages: UIMessage[] = [];
	if (streaming.text || streaming.thinking || preTools.length > 0) {
		assistantMessages.push({
			kind: "assistant",

			id: streaming.id,
			text: streaming.text,
			thinking: streaming.thinking,
			tools: preTools,
			timestamp: at,
		});
	}
	if (postTools.length > 0) {
		assistantMessages.push({
			kind: "assistant",
			id: newMessageId(),
			text: "",
			thinking: "",
			tools: postTools,
			timestamp: at,
		});
	}
	return {
		...state,
		messages: insertByTime(messages, [...assistantMessages, ...subagents, ...images], at),
		streaming: null,
	};
}

function commitLlmErrorCard(state: SessionTranscriptState, error: UiError): SessionTranscriptState {
	return {
		...state,
		pendingLlmError: null,
		messages: [
			...state.messages,
			{ kind: "error" as const, id: newMessageId(), text: "", timestamp: error.timestamp, error },
		],
	};
}

export const REDUCED_EVENT_TYPES = [
	"agent_start",
	"agent_end",
	"agent_settled",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"ptc_subcall",
	"queue_update",
	"compaction_start",
	"compaction_end",
	"subagent_mutex",
	"auto_retry_start",
	"auto_retry_end",
	"stream_guard_tripped",
	"agent_say",
] as const;

export function reduceEvent(state: SessionTranscriptState, event: SessionEvent): SessionTranscriptState {
	switch (event.type) {
		case "stream_guard_tripped": {
			const card = buildStreamGuardUiError(event.verdict);
			const final = finalizeStreaming(state);
			return appendMessage(
				{ ...final, pendingLlmError: null },
				{
					kind: "error" as const,
					id: newMessageId(),
					text: "",
					timestamp: card.timestamp,
					error: card,
				},
			);
		}
		case "subagent_mutex": {
			if (
				state.messages.some(
					(message) => message.kind === "system" && message.mutex?.extensionPath === event.extensionPath,
				)
			)
				return state;
			return appendMessage(state, {
				kind: "system" as const,
				id: newMessageId(),
				text: "",
				timestamp: Date.now(),
				mutex: { extensionPath: event.extensionPath, tools: event.tools },
			});
		}
		case "agent_say": {
			const text = event.text.trim();
			if (!text) return state;

			const idx = state.messages.findIndex(
				(m) => m.kind === "agent" && (m.id === event.id || (m.agent === event.agent && m.text === text)),
			);
			const streaming = event.done === false;
			if (idx >= 0) {
				const current = state.messages[idx] as Extract<UIMessage, { kind: "agent" }>;
				if (current.text === text && current.id === event.id && (current.streaming ?? false) === streaming)
					return state;
				const next = [...state.messages];
				next[idx] = {
					...current,
					id: event.id,
					text,
					streaming,
					...(event.sessionFile ? { sessionFile: event.sessionFile } : {}),
				};
				return { ...state, messages: next };
			}
			return appendMessage(state, {
				kind: "agent" as const,
				id: event.id,
				text,
				timestamp: event.at,
				agent: event.agent,
				streaming,
				...(event.sessionFile ? { sessionFile: event.sessionFile } : {}),
			});
		}
		case "agent_start":
			return {
				...state,
				phase: "streaming",
				agentActive: true,
				streaming: emptyStreaming(),

				runEndedAt: undefined,
			};
		case "turn_start": {
			return {
				...state,
				phase: "streaming",
				streaming: emptyStreaming(),
			};
		}
		case "message_start": {
			if (event.message.role === "assistant" && !state.streaming) {
				state = {
					...state,
					streaming: emptyStreaming(),
				};
			}
			if (event.message.role !== "user") return state;
			const content = event.message.content;
			const text =
				typeof content === "string"
					? content
					: content
							.filter((c) => c.type === "text")
							.map((c) => (c as { text: string }).text)
							.join("");
			const invocation = parseExpandedSkillInvocation(text);
			const images: ImageInput[] = Array.isArray(content)
				? content
						.filter((c) => c.type === "image" && (c as { data?: string }).data)
						.map((c) => ({
							data: (c as { data: string }).data,
							mimeType: (c as { mimeType?: string }).mimeType ?? "image/png",
						}))
				: [];
			return {
				...state,
				messages: [
					...state.messages,
					{
						kind: "user",
						id: newMessageId(),
						text: invocation ? (invocation.args ?? "") : text,
						images,
						timestamp: event.message.timestamp ?? Date.now(),
						...(invocation
							? {
									skill: { name: invocation.name, args: invocation.args },
									sourceText: text,
								}
							: {}),
					},
				],
			};
		}
		case "message_update":
			return withStreaming(state, (streaming) =>
				applyAssistantMessageUpdate(streaming, event.assistantMessageEvent),
			);
		case "tool_execution_start":
			return withStreaming(state, (streaming) => {
				const startArgs = (event.args ?? {}) as {
					action?: unknown;
					agent?: unknown;
					task?: unknown;
					tasks?: Array<{ agent?: unknown; task?: unknown }>;
				};
				const parallelTasks = Array.isArray(startArgs.tasks) ? startArgs.tasks : [];
				const runInputs =
					event.toolName === "subagent" && startArgs.action == null
						? typeof startArgs.agent === "string"
							? [{ agent: startArgs.agent, task: startArgs.task }]
							: parallelTasks.filter((task) => typeof task.agent === "string")
						: [];
				if (runInputs.length > 0) {
					const start = streaming.subagentRuns.length;
					const runs: SubagentRunUi[] = runInputs.map((input, index) => ({
						key: `${event.toolCallId}:${index}`,
						agent: typeof input.agent === "string" && input.agent.length > 0 ? input.agent : "subagent",
						task: typeof input.task === "string" && input.task.length > 0 ? input.task : undefined,
						status: "running",
					}));

					const removedTool = streaming.tools.find((t) => t.id === event.toolCallId);
					const activity =
						removedTool?.blockIndex != null
							? streaming.activity.filter((a) => a.id !== `c${removedTool.blockIndex}`)
							: streaming.activity;
					return {
						...streaming,
						tools: streaming.tools.filter((t) => t.id !== event.toolCallId),
						activity,
						subagentRuns: [...streaming.subagentRuns, ...runs],
						subagentByToolCallId: {
							...streaming.subagentByToolCallId,
							[event.toolCallId]: { start, count: runs.length },
						},
					};
				}
				return {
					...streaming,
					tools: patchStreamingTool(streaming.tools, event.toolCallId, (t) => ({
						...t,
						state: "running" as const,
					})),
				};
			});
		case "tool_execution_update":
			return withStreaming(state, (streaming) => {
				const delta = extractExecutionDelta(event.partialResult);
				const placement = streaming.subagentByToolCallId[event.toolCallId];
				const progress = placement
					? extractSubagentRuns((event.partialResult as { details?: unknown } | null | undefined)?.details)
					: null;
				let subagentRuns = streaming.subagentRuns;
				if (placement && progress) {
					const next = [...subagentRuns];
					for (const update of progress) {
						if (!update.sessionFile) continue;
						const index = next.findIndex(
							(run, i) =>
								i >= placement.start &&
								i < placement.start + placement.count &&
								run.sessionFile == null &&
								run.agent === update.agent &&
								(update.task == null || run.task === update.task),
						);
						const current = index >= 0 ? next[index] : undefined;
						if (current)
							next[index] = {
								...current,
								sessionFile: update.sessionFile,
								...(update.thinkingLevel ? { thinkingLevel: update.thinkingLevel } : {}),

								...(update.result != null ? { result: update.result } : {}),
							};
					}
					subagentRuns = next;
				}
				if (!delta && subagentRuns === streaming.subagentRuns) return streaming;
				const rawToolOutputs = delta
					? {
							...streaming.rawToolOutputs,
							[event.toolCallId]:
								(streaming.rawToolOutputs?.[event.toolCallId] ??
									streaming.tools.find((tool) => tool.id === event.toolCallId)?.output ??
									"") + delta,
						}
					: streaming.rawToolOutputs;
				const tools = delta
					? patchStreamingTool(streaming.tools, event.toolCallId, (tool) => ({
							...tool,
							output: rawToolOutputs?.[event.toolCallId] ?? "",
						}))
					: streaming.tools;
				return { ...streaming, tools, rawToolOutputs, subagentRuns };
			});
		case "tool_execution_end": {
			let next = state;
			if (event.toolName === TODO_TOOL_NAME && !event.isError) {
				const todos = extractTodos((event.result as { details?: unknown } | null | undefined)?.details);
				if (todos) next = { ...state, todos };
			}
			const streaming = next.streaming;
			if (!streaming) return next;
			const extracted = extractSubagentRuns(
				(event.result as { details?: unknown } | null | undefined)?.details,
			);
			const placement = streaming.subagentByToolCallId[event.toolCallId];
			if (placement !== undefined || (extracted && extracted.length > 0)) {
				const start = placement?.start ?? streaming.subagentRuns.length;
				const count = placement?.count ?? 0;
				const before = streaming.subagentRuns.slice(0, start);
				const after = placement ? streaming.subagentRuns.slice(start + count) : [];
				const placeholders = placement ? streaming.subagentRuns.slice(start, start + count) : [];
				const runs: SubagentRunUi[] =
					extracted && extracted.length > 0
						? extracted.map((run, index) => ({ ...run, key: `${event.toolCallId}:${index}` }))
						: placeholders.map((placeholder) => ({
								key: placeholder.key,
								agent: placeholder.agent,
								task: placeholder.task,
								status: event.isError ? ("error" as const) : ("done" as const),
							}));

				const endedTool = streaming.tools.find((t) => t.id === event.toolCallId);
				const activity =
					endedTool?.blockIndex != null
						? streaming.activity.filter((a) => a.id !== `c${endedTool.blockIndex}`)
						: streaming.activity;
				return {
					...next,
					streaming: {
						...streaming,
						tools: streaming.tools.filter((t) => t.id !== event.toolCallId),
						activity,
						subagentRuns: [...before, ...runs, ...after],
					},
				};
			}

			const editPatch = event.toolName === "edit" && !event.isError ? extractEditPatch(event.result) : null;
			const tools = patchStreamingTool(streaming.tools, event.toolCallId, (t) => {
				const fill = !t.output && !event.isError ? extractResultText(event.result) : "";
				return {
					...t,
					state: (event.isError ? "error" : "done") as "error" | "done",

					endedAt: Date.now(),
					...(editPatch ? { diff: editPatch } : {}),
					...(fill ? { output: fill } : {}),
				};
			});

			const shown = event.toolName === "show_image" && !event.isError ? extractShowImage(event.result) : null;
			return {
				...next,
				streaming: {
					...streaming,
					tools,
					pendingImages: shown ? [...streaming.pendingImages, shown] : streaming.pendingImages,
				},
			};
		}
		case "ptc_subcall": {
			return withStreaming(state, (streaming) => {
				if (event.phase === "end") {
					const tools = streaming.tools.map((t) =>
						t.id === event.id
							? {
									...t,
									state: (event.ok === false ? "error" : "done") as "error" | "done",
									endedAt: Date.now(),
									...(event.error ? { output: event.error } : {}),
								}
							: t,
					);
					return { ...streaming, tools };
				}

				const parent = streaming.tools.find((t) => t.id === event.parentToolCallId);
				const tools = [
					...streaming.tools,
					{
						key: `ptc:${event.id}`,
						id: event.id,
						name: event.tool,
						args: event.args ?? "",
						output: "",
						blockIndex: parent?.blockIndex,
						state: "running" as const,
					},
				];
				return {
					...streaming,
					tools,

					activity: [
						...streaming.activity,
						{ id: `p${event.id}`, kind: "tool" as const, name: event.tool, args: event.args ?? "" },
					],
				};
			});
		}
		case "auto_retry_start":
			return {
				...state,
				retrying: { attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs },
			};
		case "auto_retry_end":
			return { ...state, retrying: null };
		case "turn_end": {
			const reconciled = reconcileStreamingWithFinalMessage(state, event.message);
			const final = finalizeStreaming({ ...reconciled, phase: "idle" });

			const message = event.message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
			if (isLlmErrorRound(message)) {
				return { ...final, pendingLlmError: buildRoundErrorCard(message) };
			}
			return final;
		}
		case "agent_end": {
			const final = finalizeStreaming({
				...state,
				phase: event.willRetry ? "streaming" : "idle",

				agentActive: event.willRetry ? state.agentActive : false,

				...(event.willRetry ? {} : { runEndedAt: Date.now() }),
			});

			if (final.pendingLlmError && !event.willRetry) return commitLlmErrorCard(final, final.pendingLlmError);
			return final.pendingLlmError ? { ...final, pendingLlmError: null } : final;
		}
		case "agent_settled": {
			const final = finalizeStreaming({
				...state,
				phase: "idle",
				agentActive: false,
				retrying: null,
				runEndedAt: Date.now(),
			});
			return final.pendingLlmError ? commitLlmErrorCard(final, final.pendingLlmError) : final;
		}
		case "queue_update":
			return { ...state, followUpQueue: [...event.followUp] };
		case "compaction_start": {
			const pending: UIMessage = {
				kind: "system",
				id: `compaction-${Date.now()}-${state.messages.length}`,
				text: "",
				timestamp: Date.now(),
				compact: { status: "running", reason: event.reason },
			};
			return { ...state, compacting: true, messages: [...state.messages, pending] };
		}
		case "compaction_end": {
			const errorMessage = event.errorMessage?.replace(/^Compaction failed:\s*/i, "");
			const info: CompactionUiState = event.aborted
				? { status: "cancelled", reason: event.reason }
				: event.errorMessage
					? { status: "error", reason: event.reason, errorMessage }
					: {
							status: "done",
							reason: event.reason,
							summary: event.result?.summary,
							tokensBefore: event.result?.tokensBefore,
							tokensAfter: event.result?.estimatedTokensAfter,
						};

			const idx = findLastIndex(
				state.messages,
				(m) => m.kind === "system" && m.compact?.status === "running",
			);
			if (idx >= 0) {
				const messages = state.messages.map((m, i) =>
					i === idx ? ({ ...m, compact: info } as UIMessage) : m,
				);
				return { ...state, compacting: false, messages };
			}
			const entry: UIMessage = {
				kind: "system",
				id: `compaction-${Date.now()}-${state.messages.length}`,
				text: "",
				timestamp: Date.now(),
				compact: info,
			};
			return appendMessage({ ...state, compacting: false }, entry);
		}
		default:
			return state;
	}
}
