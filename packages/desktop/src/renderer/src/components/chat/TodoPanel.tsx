import type { TodoItem } from "@tcode/shared";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { EMPTY_TODOS, useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { TodoCompleteIcon, TodoPendingIcon, TodoSpinnerIcon } from "../icons";

const RING_R = 8;
const RING_C = 2 * Math.PI * RING_R;

function TodoProgressRing({ done, total }: { done: number; total: number }) {
	const pct = total > 0 ? done / total : 0;
	return (
		<svg width="18" height="18" viewBox="0 0 20 20" className="shrink-0 -rotate-90" aria-hidden="true">
			<circle cx="10" cy="10" r={RING_R} fill="none" strokeWidth="2.5" className="stroke-hover" />
			<circle
				cx="10"
				cy="10"
				r={RING_R}
				fill="none"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray={RING_C}
				strokeDashoffset={RING_C * (1 - pct)}
				className="stroke-green-500 transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
			/>
		</svg>
	);
}

export function TodoRow({ todo, spinnerPaused }: { todo: TodoItem; spinnerPaused?: boolean }) {
	if (todo.status === "completed") {
		return (
			<li className="flex items-start gap-2 rounded-md px-2 py-1">
				<TodoCompleteIcon size={14} className="mt-[3px] shrink-0 text-green-500" />
				<span className="min-w-0 flex-1 break-words text-[13px] leading-5 text-ink-dim line-through">
					{todo.content}
				</span>
			</li>
		);
	}
	if (todo.status === "in_progress") {
		return (
			<li className="flex items-start gap-2 rounded-md px-2 py-1">
				<TodoSpinnerIcon
					size={14}
					paused={spinnerPaused}
					className={`mt-[3px] shrink-0 text-ink-2 ${spinnerPaused ? "" : "animate-spin"}`}
				/>
				<span className="min-w-0 flex-1 break-words text-[13px] leading-5 text-ink font-medium">
					{todo.content}
				</span>
			</li>
		);
	}
	return (
		<li className="flex items-start gap-2 rounded-md px-2 py-1">
			<TodoPendingIcon size={14} className="mt-[3px] shrink-0 text-ink-faint" />
			<span className="min-w-0 flex-1 break-words text-[13px] leading-5 text-ink-2">{todo.content}</span>
		</li>
	);
}

export function TodoPanel() {
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const todos =
		useTranscriptStore((s) => (activeSessionId ? s.bySession[activeSessionId]?.todos : undefined)) ??
		EMPTY_TODOS;
	const expanded = useUiStore((s) => (activeSessionId ? (s.todoExpanded[activeSessionId] ?? false) : false));
	const toggle = useUiStore((s) => s.toggleTodoExpanded);

	const agentActive = useTranscriptStore((s) =>
		activeSessionId ? (s.bySession[activeSessionId]?.agentActive ?? false) : false,
	);
	const t = useT();

	if (todos.length === 0 || !activeSessionId) return null;

	const done = todos.filter((x) => x.status === "completed").length;

	return (
		<div className="absolute top-2 right-4 z-20 max-w-[calc(100%-2rem)]">
			<div
				className={`overflow-hidden rounded-xl bg-surface shadow-pop transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
					expanded ? "w-64" : "w-40"
				}`}
			>
				<button
					type="button"
					onClick={() => toggle(activeSessionId)}
					aria-expanded={expanded}
					className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
				>
					<span
						className={`todo-breath-dot ${agentActive ? "" : "todo-breath-dot-paused"}`}
						aria-hidden="true"
					/>
					<span className="shrink-0 text-[13px] font-medium text-ink-dim">{t("todo.title")}</span>
					<span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
						{done}/{todos.length}
					</span>
					<span className="ml-auto shrink-0">
						<TodoProgressRing done={done} total={todos.length} />
					</span>
				</button>

				<div
					className={`grid w-64 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
						expanded ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0"
					}`}
					aria-hidden={!expanded}
				>
					<div className="overflow-hidden">
						<ul className="max-h-72 overflow-y-auto px-1.5 pt-1 pb-1.5">
							{todos.map((todo, i) => (
								<TodoRow key={i} todo={todo} spinnerPaused={!agentActive} />
							))}
						</ul>
					</div>
				</div>
			</div>
		</div>
	);
}
