import type { SubagentRunUi } from "@tcode/shared";
import { useMemo } from "react";
import { SubagentRunCard } from "../../components/chat/SubagentRunCard";
import { useTranscriptStore } from "../../stores/transcript";
import type { SidePanePanelProps } from "../panelProps";

export function SubagentDirectoryPanel({ sessionId, t }: SidePanePanelProps) {
	const messages = useTranscriptStore((state) =>
		sessionId ? state.bySession[sessionId]?.messages : undefined,
	);
	const runs = useMemo(() => {
		const seen = new Set<string>();
		const collected: SubagentRunUi[] = [];
		for (const message of messages ?? []) {
			if (message.kind !== "subagent") continue;
			for (const run of message.runs) {
				if (seen.has(run.key)) continue;
				seen.add(run.key);
				collected.push(run);
			}
		}
		return collected;
	}, [messages]);

	if (runs.length === 0) {
		return (
			<div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-ink-faint">
				{t("sidepane.subagents.empty")}
			</div>
		);
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
			<SubagentRunCard runs={runs} />
		</div>
	);
}
