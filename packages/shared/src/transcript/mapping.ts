import type { UiError } from "../errors";
import type { SessionMessage } from "../session";
import { newSubagentKey, newToolKey } from "./helpers";
import { buildRoundErrorCard, isLlmErrorRound } from "./llm-errors";
import type { UIMessage, UIToolCall } from "./types";

export function messagesToUIMessages(messages: SessionMessage[]): UIMessage[] {
	const ui: UIMessage[] = [];

	let pendingError: UiError | null = null;
	const flushError = () => {
		if (!pendingError) return;
		ui.push({
			kind: "error" as const,
			id: `e${ui.length}`,
			text: "",
			timestamp: pendingError.timestamp,
			error: pendingError,
		});
		pendingError = null;
	};
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (!m) continue;
		const id = `h${i}`;
		if (m.role === "compaction") {
			ui.push({
				kind: "system",
				id,
				text: "",
				timestamp: m.timestamp,
				compact: {
					status: "done",
					...(m.summary ? { summary: m.summary } : {}),
					...(typeof m.tokensBefore === "number" ? { tokensBefore: m.tokensBefore } : {}),
				},
			});
			continue;
		}
		if (m.role === "image") {
			flushError();
			ui.push({ kind: "image", id, images: m.images, paths: m.paths, timestamp: m.timestamp });
			continue;
		}
		if (m.role === "subagent") {
			flushError();
			ui.push({
				kind: "subagent",
				id,
				runs: m.runs.map((run) => ({ ...run, key: newSubagentKey() })),
				timestamp: m.timestamp,
			});
			continue;
		}
		if (m.role === "agent") {
			flushError();
			ui.push({
				kind: "agent",
				id,
				text: m.text,
				timestamp: m.timestamp,
				agent: m.agent,
				...(m.sessionFile ? { sessionFile: m.sessionFile } : {}),
			});
			continue;
		}
		if (m.role === "user") {
			flushError();
			const text = m.text;
			const sourceText = m.sourceText;
			if (m.skill || text || m.images.length > 0) {
				ui.push({
					kind: "user",
					id,
					text,
					images: m.images,
					timestamp: m.timestamp,
					entryId: m.entryId,
					skill: m.skill,
					...(sourceText !== undefined ? { sourceText } : {}),
				});
			}
			continue;
		}
		const text = m.text;
		const sourceText = m.sourceText;
		const tools: UIToolCall[] = m.tools.map((tool) => ({
			key: tool.id || newToolKey(),
			id: tool.id,
			name: tool.name,
			args: tool.args,
			output: tool.output,
			...(tool.diff ? { diff: tool.diff } : {}),
			...(tool.endedAt !== undefined ? { endedAt: tool.endedAt } : {}),
			...(tool.subCallTotal !== undefined ? { subCallTotal: tool.subCallTotal } : {}),
			state: tool.isError ? "error" : "done",
		}));
		const assistant: UIMessage = {
			kind: "assistant",
			id,
			text,
			thinking: m.thinking,
			tools,
			timestamp: m.timestamp,
			entryId: m.entryId,
			...(sourceText !== undefined ? { sourceText } : {}),
		};

		if (isLlmErrorRound(m)) {
			pendingError = buildRoundErrorCard(m, m.timestamp);
			if (text || m.thinking.length > 0 || tools.length > 0) ui.push(assistant);
			continue;
		}
		flushError();
		ui.push(assistant);
	}
	flushError();
	return ui;
}
