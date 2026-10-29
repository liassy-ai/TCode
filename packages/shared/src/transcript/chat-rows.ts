import type { TurnChanges } from "./turn-files";
import type { TurnTiming } from "./turn-timings";
import type { ActivityEntry, StreamingState, SubagentRunUi, UIMessage, UIToolCall } from "./types";

export interface MetaItem {
	thinking: string;
	tools: UIToolCall[];

	activity?: ActivityEntry[];
}

export type ChatRow =
	| {
			kind: "metaGroup";
			key: string;
			items: MetaItem[];

			working: boolean;

			endImmediately: boolean;
			subagentCount: number;
	  }
	| {
			kind: "message";
			key: string;
			message: UIMessage;

			metaInGroup: boolean;

			showActions: boolean;

			turnTiming?: TurnTiming;

			turnChanges?: TurnChanges;

			streaming: boolean;
	  }
	| { kind: "streamingSubagents"; key: string; runs: SubagentRunUi[] }
	| {
			kind: "turnDiff";
			key: string;

			changes?: TurnChanges;

			timing?: TurnTiming;

			hasFinalText: boolean;

			running: boolean;

			afterMetaGroup: boolean;

			entering: boolean;
	  };

export interface ChatRowsInput {
	messages: UIMessage[];
	streaming: StreamingState | null;
	agentActive: boolean;
	runEndedAt?: number;
}

export function isAgentWorking(input: Pick<ChatRowsInput, "agentActive" | "streaming">): boolean {
	const { streaming } = input;
	const hasRunningWork = Boolean(
		streaming?.tools.some((t) => t.state === "running") ||
			streaming?.subagentRuns.some((r) => r.status === "running"),
	);
	return input.agentActive && (!streaming?.text.trim() || hasRunningWork);
}

const committedMetaCache = new WeakMap<Extract<UIMessage, { kind: "assistant" }>, MetaItem>();
function committedMetaItem(message: Extract<UIMessage, { kind: "assistant" }>): MetaItem {
	let item = committedMetaCache.get(message);
	if (!item) {
		item = { thinking: message.thinking, tools: message.tools };
		committedMetaCache.set(message, item);
	}
	return item;
}

export interface TurnDiffRowsOptions {
	turnChanges?: TurnChanges[];

	turnTimings?: TurnTiming[];

	enteringTurn?: number | null;
}

export function buildChatRows(
	transcript: ChatRowsInput,
	sessionId: string,
	now: number = Date.now(),
	opts?: TurnDiffRowsOptions,
): ChatRow[] {
	const { streaming } = transcript;
	const agentWorking = isAgentWorking(transcript);
	const rows: ChatRow[] = [];
	let metaItems: MetaItem[] = [];

	const turnFinalTextIds = new Set<string>();
	let lastTextId: string | null = null;
	for (const message of transcript.messages) {
		if (message.kind === "user") {
			if (lastTextId) turnFinalTextIds.add(lastTextId);
			lastTextId = null;
			continue;
		}
		if (message.kind === "assistant" && message.text.trim()) lastTextId = message.id;
	}
	if (!transcript.agentActive && lastTextId) turnFinalTextIds.add(lastTextId);

	let groupIndex = 0;
	const flushMeta = (isLatest = false, forceEmpty = false, subagentCount = 0): void => {
		if (metaItems.length === 0 && !forceEmpty && subagentCount === 0) return;

		const endImmediately = !isLatest || Boolean(streaming?.text.trim()) || !transcript.agentActive;
		rows.push({
			kind: "metaGroup",
			key: `meta-${sessionId}-g${groupIndex++}`,
			items: metaItems,
			working: isLatest && agentWorking,
			endImmediately,
			subagentCount,
		});
		metaItems = [];
	};

	const { turnChanges, turnTimings, enteringTurn } = opts ?? {};
	const changeByTurn = turnChanges ? new Map(turnChanges.map((tc) => [tc.turnIndex, tc])) : null;
	const timingByTurn = turnTimings ? new Map(turnTimings.map((tt) => [tt.turnIndex, tt])) : null;

	const finalTextByTurn = new Map<number, boolean>();
	let userRowCount = 0;
	const pushTurnDiffRow = (turnIndex: number, running: boolean): void => {
		rows.push({
			kind: "turnDiff",
			key: `turn-diff-${turnIndex}`,
			changes: changeByTurn?.get(turnIndex),
			timing: timingByTurn?.get(turnIndex),
			hasFinalText: finalTextByTurn.get(turnIndex) === true,
			running,

			afterMetaGroup: rows[rows.length - 1]?.kind === "metaGroup",
			entering: turnIndex === enteringTurn,
		});
	};
	const hasFooterRow = (turnIndex: number): boolean =>
		Boolean(changeByTurn?.get(turnIndex) || timingByTurn?.get(turnIndex));

	for (const message of transcript.messages) {
		if (message.kind === "subagent") {
			flushMeta(false, false, message.runs.length);
			rows.push({
				kind: "message",
				key: message.id,
				message,
				metaInGroup: false,
				showActions: false,
				streaming: false,
			});
			continue;
		}
		if (message.kind !== "assistant") {
			flushMeta();
			if (message.kind === "user" && (changeByTurn || timingByTurn)) {
				if (hasFooterRow(userRowCount - 1)) pushTurnDiffRow(userRowCount - 1, false);
				userRowCount++;
			}
			rows.push({
				kind: "message",
				key: message.id,
				message,
				metaInGroup: false,
				showActions: false,
				streaming: false,
			});
			continue;
		}

		if (message.thinking || message.tools.length > 0) {
			metaItems.push(committedMetaItem(message));
		}

		if (message.text.trim()) {
			flushMeta();
			const isFinalText = turnFinalTextIds.has(message.id);
			const turnIndex = userRowCount - 1;
			rows.push({
				kind: "message",
				key: message.id,
				message,
				metaInGroup: true,
				showActions: isFinalText,
				turnTiming: isFinalText ? timingByTurn?.get(turnIndex) : undefined,
				turnChanges: isFinalText ? changeByTurn?.get(turnIndex) : undefined,
				streaming: false,
			});
			if (isFinalText) finalTextByTurn.set(turnIndex, true);
		}
	}

	let streamingInsertAt = rows.length;
	if (streaming) {
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (row && row.kind === "message" && row.message.timestamp > streaming.startedAt) {
				streamingInsertAt = i;
				break;
			}
		}
	}
	const streamingBlockStart = rows.length;
	if (streaming) {
		const textIdx = streaming.textBlockIndex;
		const preTools =
			textIdx == null ? streaming.tools : streaming.tools.filter((t) => (t.blockIndex ?? 0) < textIdx);
		const postTools = textIdx == null ? [] : streaming.tools.filter((t) => (t.blockIndex ?? 0) > textIdx);
		if (streaming.thinking || preTools.length > 0) {
			metaItems.push({
				thinking: streaming.thinking,
				tools: preTools,

				activity: textIdx == null ? streaming.activity : undefined,
			});
		}
		if (streaming.text.trim()) {
			flushMeta();
			rows.push({
				kind: "message",
				key: streaming.id,
				message: {
					kind: "assistant",
					id: streaming.id,
					text: streaming.text,
					thinking: streaming.thinking,
					tools: streaming.tools,
					timestamp: now,
				},
				metaInGroup: true,
				showActions: false,
				streaming: true,
			});
		}

		if (postTools.length > 0) {
			metaItems.push({ thinking: "", tools: postTools, activity: streaming.activity });
		}
	}

	if (metaItems.length === 0 && agentWorking && streaming && streaming.activity.length > 0) {
		metaItems.push({ thinking: "", tools: [], activity: streaming.activity });
	}

	const streamingSubagentRuns = streaming?.subagentRuns ?? [];
	flushMeta(true, agentWorking, streamingSubagentRuns.length);
	if (streamingSubagentRuns.length > 0) {
		rows.push({ kind: "streamingSubagents", key: "streaming-subagents", runs: streamingSubagentRuns });
	}

	if (streamingInsertAt < streamingBlockStart) {
		const block = rows.splice(streamingBlockStart);
		rows.splice(streamingInsertAt, 0, ...block);
	}

	if (changeByTurn || timingByTurn) {
		if (hasFooterRow(userRowCount - 1)) pushTurnDiffRow(userRowCount - 1, transcript.agentActive);
	}
	return rows;
}
