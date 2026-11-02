import { type MessageKey, useT } from "../../i18n";
import { openSubagentSessionTab } from "../../sidepane/openers";
import { useSessionsStore } from "../../stores/sessions";
import type { SubagentRunUi } from "../../stores/transcript";
import { sessionAvatarClass } from "../session/session-status";

function displayName(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

function SubagentRunRow({ run }: { run: SubagentRunUi }) {
	const t = useT();

	const clickable = run.sessionFile != null;

	const openInspect = () => {
		if (!run.sessionFile) return;
		openSubagentSessionTab({
			file: run.sessionFile,
			agent: run.agent,
			task: run.task ?? "",
			sessionId: useSessionsStore.getState().activeSessionId,
		});
	};
	const statusLabel =
		run.status === "running"
			? t("message.subagent.running")
			: run.status === "error"
				? t("message.subagent.failed")
				: t("message.subagent.done");

	return (
		<button
			type="button"
			disabled={!clickable}
			onClick={() => clickable && openInspect()}
			className={`flex w-full items-center gap-3 rounded-lg px-1.5 py-2 text-left ${
				clickable ? "cursor-pointer hover:bg-hover" : "cursor-default"
			} transition-colors`}
		>
			<span
				className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold ${sessionAvatarClass(
					run.status === "running" ? "working" : "idle",

					{ isActive: true, daily: false },
				)}`}
			>
				{displayName(run.agent).charAt(0)}
				{run.status !== "running" && (
					<span
						aria-hidden="true"
						className={`absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-canvas ${
							run.status === "error" ? "bg-red-500" : "bg-green-500"
						}`}
					/>
				)}
			</span>
			<span className="truncate text-sm font-semibold text-ink">{displayName(run.agent)}</span>
			{run.thinkingLevel && (
				<span className="shrink-0 text-xs text-ink-faint">
					{t(`thinkingLevels.${run.thinkingLevel}` as MessageKey)}
				</span>
			)}
			<span className="shrink-0 text-xs text-ink-faint">{statusLabel}</span>
		</button>
	);
}

export function SubagentRunCard({ runs }: { runs: SubagentRunUi[] }) {
	return (
		<div className="mt-1 space-y-2">
			{runs.map((run) => (
				<SubagentRunRow key={run.key} run={run} />
			))}
		</div>
	);
}
