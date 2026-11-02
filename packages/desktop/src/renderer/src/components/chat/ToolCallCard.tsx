import { type AskQuestion, extractTodos, parseAskQuestions, TODO_TOOL_NAME } from "@tcode/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useEdgeFade } from "../../lib/use-edge-fade";
import { useSessionsStore } from "../../stores/sessions";
import type { UIToolCall } from "../../stores/transcript";
import { ExpandArrowIcon } from "../icons";
import { TodoRow } from "./TodoPanel";
import { displayName } from "./tool-label";

export { displayName } from "./tool-label";

interface MeasureEntry {
	row: HTMLElement;
	text: HTMLElement;
	set: (overflowing: boolean) => void;
}

const measureQueue = new Map<HTMLElement, MeasureEntry>();

const MEASURE_FALLBACK_MS = 250;
let measureScheduled = false;

function flushMeasures(): void {
	measureScheduled = false;
	const entries = [...measureQueue.values()];
	measureQueue.clear();
	const results: Array<[MeasureEntry, boolean]> = [];

	for (const entry of entries) {
		const { row, text } = entry;
		if (!row.isConnected || !text.isConnected) continue;
		const left = text.getBoundingClientRect().left - row.getBoundingClientRect().left;
		results.push([entry, text.scrollWidth > row.clientWidth - left]);
	}

	for (const [entry, overflowing] of results) entry.set(overflowing);
}

function scheduleMeasure(entry: MeasureEntry): void {
	measureQueue.set(entry.row, entry);
	if (measureScheduled) return;
	measureScheduled = true;

	let done = false;
	const run = () => {
		if (done) return;
		done = true;
		cancelAnimationFrame(raf);
		clearTimeout(timer);
		flushMeasures();
	};
	const raf = requestAnimationFrame(run);
	const timer = setTimeout(run, MEASURE_FALLBACK_MS);
}

const rowEntries = new WeakMap<HTMLElement, MeasureEntry>();

const rowResizeObserver =
	typeof ResizeObserver === "undefined"
		? null
		: new ResizeObserver((entries) => {
				for (const entry of entries) {
					if (!(entry.target instanceof HTMLElement)) continue;
					const known = rowEntries.get(entry.target);
					if (known) scheduleMeasure(known);
				}
			});

export function summarizeArgs(args: string): string {
	if (!args || args === "{}") return "";
	try {
		const parsed = JSON.parse(args) as Record<string, unknown>;
		const command = parsed.command ?? parsed.cmd;
		if (typeof command === "string") return command;
		const filePath = parsed.filePath ?? parsed.path ?? parsed.file;
		if (typeof filePath === "string") return filePath;
		const url = parsed.url;
		if (typeof url === "string") return url;

		const code = parsed.code;
		if (typeof code === "string") {
			const description = parsed.description;
			if (typeof description === "string" && description.trim()) return description.trim();
			const firstLine = code
				.split("\n")
				.find((line) => line.trim().length > 0)
				?.trim();
			if (firstLine) return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
		}
	} catch {
		for (const key of ["command", "cmd", "filePath", "path", "file", "url"]) {
			const value = args.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))?.[1];
			if (value) return value;
		}

		if (args.includes('"code"')) {
			const description = args.match(/"description"\s*:\s*"((?:[^"\\\\]|\\\\.)*)/)?.[1];
			if (description) return description;
		}
	}
	const trimmed = args.slice(0, 120);
	return trimmed.length < args.length ? `${trimmed}…` : trimmed;
}

const ARGS_HIDDEN_TOOLS = new Set(["run_code"]);

const ASK_TOOLS = new Set(["ask_user", "questionnaire"]);

function formatBlock(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

function AskUserBlock({ questions, output }: { questions: AskQuestion[]; output?: string }) {
	const t = useT();
	const out = output ?? "";

	const isChosen = (option: string) => option.length > 0 && out.includes(option);
	return (
		<ul className="flex flex-col gap-2 border-border border-l py-1 pl-3 text-[12px]">
			{questions.map((q, i) => {
				const options = q.options ?? [];
				return (
					<li key={q.question ?? `q${i}`}>
						<div className="text-ink-2">
							{q.question}
							{q.multiple && <span className="ml-1.5 text-ink-faint">{t("dialogs.multiple")}</span>}
						</div>
						{options.length > 0 && (
							<div className="mt-0.5 flex flex-col gap-0.5 text-ink-faint">
								{options.map((o) => (
									<div key={o} className={isChosen(o) ? "text-ink-2" : ""}>
										{isChosen(o) ? "→ " : "· "}
										{o}
									</div>
								))}
							</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}
function ToolBlock({ text, dim }: { text: string; dim?: boolean }) {
	const ref = useRef<HTMLPreElement>(null);
	const t = useT();

	const [full, setFull] = useState(false);
	useEdgeFade(ref);

	const formatted = useMemo(() => formatBlock(text), [text]);
	const long = formatted.length > MAX_BLOCK_CHARS;
	const shown = long && !full ? `${formatted.slice(0, MAX_BLOCK_CHARS)}…` : formatted;
	return (
		<div className="relative border-border border-l">
			<pre
				ref={ref}
				className={`edge-fade max-h-56 overflow-y-auto py-1 pl-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap select-text ${
					dim ? "text-ink-dim" : "text-ink-2"
				}`}
			>
				{shown}
			</pre>
			{long && !full && (
				<button
					type="button"
					className="cursor-pointer py-0.5 text-left font-mono text-[12px] text-ink-faint transition-colors hover:text-ink-2"
					onClick={() => setFull(true)}
				>
					{t("tool.showFullText", { count: text.length })}
				</button>
			)}
		</div>
	);
}

function lastProgressLine(tool: UIToolCall): string | null {
	if (tool.state !== "running" || !tool.output) return null;
	const lines = tool.output.split("\n").filter((line) => line.trim().length > 0);
	return lines.length > 0 ? (lines[lines.length - 1] ?? null) : null;
}

const NO_SUB_CALLS: UIToolCall[] = [];

const SUB_CALL_PAGE = 50;

const MAX_BLOCK_CHARS = 12_000;

export function ToolCallCard({
	tool,
	subCallsOf,
}: {
	tool: UIToolCall;
	subCallsOf?: (parentId: string) => UIToolCall[];
}) {
	const subCalls = subCallsOf?.(tool.id) ?? NO_SUB_CALLS;
	const t = useT();

	const [opened, setOpened] = useState(false);

	const [extraSubs, setExtraSubs] = useState<UIToolCall[]>([]);
	const [loadingSubs, setLoadingSubs] = useState(false);
	const sessionId = useSessionsStore((s) => s.activeSessionId);
	const moreRef = useRef<HTMLDivElement>(null);
	const subCallTotal = tool.subCallTotal ?? subCalls.length;
	const allSubs = extraSubs.length > 0 ? [...subCalls, ...extraSubs] : subCalls;
	const hasMoreSubs = allSubs.length < subCallTotal;
	const loadMoreSubs = useCallback(async () => {
		if (!sessionId || !hasMoreSubs || loadingSubs) return;
		setLoadingSubs(true);
		try {
			const page = await getPi().getSubCallPage({
				sessionId,
				toolCallId: tool.id,
				offset: allSubs.length,
				limit: SUB_CALL_PAGE,
			});
			if (page.rows.length > 0) {
				setExtraSubs((prev) => [
					...prev,
					...page.rows.map((row) => ({
						key: `ptc:${row.id}`,
						id: row.id,
						name: row.name,
						args: row.args,
						output: row.output,
						state: row.isError ? ("error" as const) : ("done" as const),
					})),
				]);
			}
		} finally {
			setLoadingSubs(false);
		}
	}, [sessionId, hasMoreSubs, loadingSubs, allSubs.length, tool.id]);

	useEffect(() => {
		const el = moreRef.current;
		if (!el || !hasMoreSubs || loadingSubs) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void loadMoreSubs();
			},
			{ rootMargin: "200px 0px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [hasMoreSubs, loadingSubs, loadMoreSubs]);

	const longBody = subCalls.length > 0 || (tool.args?.length ?? 0) + (tool.output?.length ?? 0) > 1200;
	const name = displayName(tool.name, t);

	const askQuestions = ASK_TOOLS.has(tool.name) ? parseAskQuestions(tool.args) : [];
	const todoArgs = useMemo(() => {
		if (tool.name !== TODO_TOOL_NAME || !tool.args) return null;
		try {
			const parsed = extractTodos(JSON.parse(tool.args));
			return parsed && parsed.length > 0 ? parsed : null;
		} catch {
			return null;
		}
	}, [tool.name, tool.args]);

	const summary =
		lastProgressLine(tool) ??
		(todoArgs
			? `${todoArgs.filter((x) => x.status === "completed").length}/${todoArgs.length}`
			: summarizeArgs(tool.args));

	const [overflowing, setOverflowing] = useState(false);
	const textRef = useRef<HTMLSpanElement>(null);
	const rowRef = useRef<HTMLElement>(null);
	const detailsRef = useRef<HTMLDetailsElement>(null);

	useEffect(() => {
		const row = rowRef.current;
		const text = textRef.current;
		if (!row || !text) return;
		const entry: MeasureEntry = { row, text, set: setOverflowing };
		rowEntries.set(row, entry);
		rowResizeObserver?.observe(row);
		scheduleMeasure(entry);
		return () => {
			measureQueue.delete(row);
			rowEntries.delete(row);
			rowResizeObserver?.unobserve(row);
		};
	}, [summary, name]);

	const nameClass = `shrink-0 font-mono text-[13px] font-semibold text-ink-dim transition-colors group-hover/row:text-ink${
		tool.state === "running" ? " shimmer-sweep" : ""
	}`;
	const summaryClass =
		"relative overflow-hidden whitespace-nowrap font-mono text-[12px] text-ink-faint transition-colors group-hover/row:text-ink";

	return (
		<details
			ref={detailsRef}
			className="group/dets drawer-details"
			onToggle={(event) => {
				if (event.currentTarget.open) setOpened(true);
			}}
		>
			<summary
				ref={rowRef}
				className="group/row flex cursor-pointer items-center gap-2 py-0.5 select-none [&::-webkit-details-marker]:hidden"
			>
				<span className={nameClass}>{name}</span>
				{summary && askQuestions.length === 0 && (
					<span
						ref={textRef}
						className={overflowing ? `${summaryClass} min-w-0 flex-1` : `${summaryClass} shrink-0`}
					>
						{summary}
						{overflowing && (
							<span className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-canvas to-transparent" />
						)}
					</span>
				)}
				{tool.state === "running" && summary && (
					<span className="shrink-0 font-mono text-[12px] text-ink-faint transition-colors group-hover/row:text-ink-2">
						…
					</span>
				)}
				<ExpandArrowIcon className="shrink-0 text-ink-faint opacity-0 transition-[opacity,transform,color] group-hover/row:opacity-100 group-hover/row:text-ink-2 group-open/dets:rotate-90" />
			</summary>
			{opened && (
				<div className="drawer-body">
					<div className="flex flex-col gap-1.5 py-1 pl-4">
						{todoArgs ? (
							<ul className="flex flex-col gap-0.5 border-border border-l py-1 pl-2">
								{todoArgs.map((todo, i) => (
									<TodoRow key={i} todo={todo} spinnerPaused />
								))}
							</ul>
						) : askQuestions.length > 0 ? (
							<AskUserBlock questions={askQuestions} output={tool.output} />
						) : (
							tool.args &&
							!ARGS_HIDDEN_TOOLS.has(tool.name) &&
							tool.args && <ToolBlock text={tool.args} dim />
						)}

						{subCalls.length > 0 && (
							<div className="flex flex-col gap-0.5 border-border border-l pl-2">
								{allSubs.map((sub) => (
									<ToolCallCard key={sub.key} tool={sub} subCallsOf={subCallsOf} />
								))}
								{hasMoreSubs && (
									<div ref={moreRef} className="py-0.5 font-mono text-[12px] text-ink-faint">
										{t("tool.loadingMore")}
									</div>
								)}
							</div>
						)}

						{tool.output && tool.name !== "run_code" && !todoArgs && askQuestions.length === 0 && (
							<ToolBlock text={tool.output} />
						)}

						{longBody && (
							<button
								type="button"
								className="cursor-pointer py-0.5 text-left font-mono text-[12px] text-ink-faint transition-colors hover:text-ink-2"
								onClick={() => {
									if (detailsRef.current) detailsRef.current.open = false;
								}}
							>
								{t("tool.collapse")}
							</button>
						)}
					</div>
				</div>
			)}
		</details>
	);
}
