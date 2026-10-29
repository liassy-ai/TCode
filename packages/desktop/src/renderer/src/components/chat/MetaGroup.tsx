import {
	dotsFromItems,
	type MetaDot,
	type MetaItem,
	ptcParentIdOf,
	summarizeCategories,
	type UIToolCall,
} from "@tcode/shared";
import { Fragment, memo, useCallback, useMemo, useRef, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { useT } from "../../i18n";
import { useEdgeFade } from "../../lib/use-edge-fade";
import { Slot } from "../../plugins/Slot";
import { UI_SLOTS } from "../../plugins/slots";
import { ExpandArrowIcon } from "../icons";
import { summaryLabel } from "./meta-summary-label";
import { type LivePreviewItem, PreviewTicker } from "./PreviewTicker";
import { ToolCallCard } from "./ToolCallCard";
import { useShownWorking } from "./use-shown-working";
import { useSweepHighlight } from "./use-sweep-highlight";
import { useTypewriter } from "./use-typewriter";

export type { MetaItem };

function ThinkingRow({ thinking, streaming }: { thinking: string; streaming: boolean }) {
	const t = useT();

	const contentRef = useRef<HTMLDivElement>(null);

	const [full, setFull] = useState(false);
	useEdgeFade(contentRef);
	const longThinking = thinking.length > MAX_BLOCK_CHARS;
	const shownThinking = longThinking && !full ? `${thinking.slice(0, MAX_BLOCK_CHARS)}…` : thinking;

	const visible = useTypewriter(shownThinking, streaming);
	return (
		<details className="group/dets drawer-details">
			<summary className="group/row flex cursor-pointer items-center gap-2 py-0.5 select-none [&::-webkit-details-marker]:hidden">
				<span className="shrink-0 text-[13px] text-ink-faint transition-colors group-hover/row:text-ink">
					{t("message.thinking")}
				</span>
				<ExpandArrowIcon className="shrink-0 text-ink-faint opacity-0 transition-[opacity,transform,color] group-hover/row:opacity-100 group-hover/row:text-ink-2 group-open/dets:rotate-90" />
			</summary>
			<div className="drawer-body">
				<div className="relative border-border border-l">
					<div
						ref={contentRef}
						className="edge-fade max-h-64 overflow-y-auto py-1 pl-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-ink-dim select-text"
					>
						{visible}
					</div>
					{longThinking && !full && (
						<button
							type="button"
							className="cursor-pointer py-0.5 pl-3 text-left font-mono text-[12px] text-ink-faint transition-colors hover:text-ink-2"
							onClick={() => setFull(true)}
						>
							{t("tool.showFullText", { count: thinking.length })}
						</button>
					)}
				</div>
			</div>
		</details>
	);
}

const DOTS_PER_ROW = 5;

const NO_SUB_CALLS: UIToolCall[] = [];

const MAX_BLOCK_CHARS = 12_000;

function dotClass(state: MetaDot["state"]): string {
	const base = "h-1 w-1 shrink-0 rounded-full";
	if (state === "running") return `${base} meta-dot-running`;
	return state === "error" ? `${base} bg-warn` : `${base} bg-ink-dim`;
}

function metaGroupPropsEqual(
	a: { items: MetaItem[]; working: boolean; endImmediately?: boolean; subagentCount?: number },
	b: { items: MetaItem[]; working: boolean; endImmediately?: boolean; subagentCount?: number },
): boolean {
	if (
		a.working !== b.working ||
		a.endImmediately !== b.endImmediately ||
		a.subagentCount !== b.subagentCount ||
		a.items.length !== b.items.length
	)
		return false;
	for (let i = 0; i < a.items.length; i++) {
		if (a.items[i] !== b.items[i]) return false;
	}
	return true;
}

export const MetaGroup = memo(function MetaGroup({
	items,
	working,
	endImmediately = false,
	subagentCount = 0,
}: {
	items: MetaItem[];
	working: boolean;
	endImmediately?: boolean;

	subagentCount?: number;
}) {
	const t = useT();
	const count = items.reduce((n, item) => n + (item.thinking ? 1 : 0) + item.tools.length, 0);

	const dots = useMemo(() => dotsFromItems(items), [items]);

	const segments = useMemo(() => summarizeCategories(items, subagentCount), [items, subagentCount]);

	const shownWorking = useShownWorking(working, endImmediately);

	const subCallsByParent = useMemo(() => {
		const map = new Map<string, UIToolCall[]>();
		for (const item of items) {
			for (const tool of item.tools) {
				const parent = ptcParentIdOf(tool);
				if (!parent) continue;
				const list = map.get(parent);
				if (list) list.push(tool);
				else map.set(parent, [tool]);
			}
		}
		return map;
	}, [items]);
	const subCallsOf = useCallback(
		(parentId: string) => subCallsByParent.get(parentId) ?? NO_SUB_CALLS,
		[subCallsByParent],
	);

	const rows = items.flatMap((item, i) => {
		const ids = new Set(item.tools.map((tool) => tool.id));
		return [
			item.thinking ? (
				<ThinkingRow key={`thinking-${i}`} thinking={item.thinking} streaming={working} />
			) : null,

			...item.tools.map((tool) => {
				const parent = ptcParentIdOf(tool);
				if (parent !== null && ids.has(parent)) return null;
				return (
					<Slot
						key={tool.key}
						name={UI_SLOTS.ToolCallCard}
						props={{ tool, subCallsOf }}
						fallback={ToolCallCard}
					/>
				);
			}),
		];
	});

	const latestActivity = useMemo(() => {
		for (let i = items.length - 1; i >= 0; i--) {
			const activity = items[i]?.activity;
			if (activity && activity.length > 0) {
				return activity[activity.length - 1];
			}
		}
		return undefined;
	}, [items]);
	const isTool = latestActivity?.kind === "tool";
	const labelKey = isTool ? "message.working" : "message.thinkingLabel";

	const runningProgress = useMemo(() => {
		for (let i = items.length - 1; i >= 0; i--) {
			const tools = items[i]?.tools ?? [];
			for (let j = tools.length - 1; j >= 0; j--) {
				const tool = tools[j];
				if (!tool || tool.state !== "running" || !tool.output) continue;
				const lines = tool.output.split("\n").filter((line) => line.trim().length > 0);
				const last = lines[lines.length - 1];
				if (last) return last;
			}
		}
		return undefined;
	}, [items]);

	const liveItems = useMemo<LivePreviewItem[]>(() => {
		const out: LivePreviewItem[] = [];
		for (const item of items) {
			if (!item.activity) continue;
			for (const entry of item.activity) {
				if (entry.kind === "thinking") {
					out.push({ kind: "thinking", id: entry.id, text: entry.text });
				} else {
					out.push({
						kind: "tool",
						id: entry.id,
						name: entry.name,
						text: entry.name === "run_code" && runningProgress ? runningProgress : entry.args,
					});
				}
			}
		}
		return out;
	}, [items, runningProgress]);

	const liveKey = liveItems.map((i) => i.id).join(",");
	const { labelRef, wrapRef: tickerWrapRef } = useSweepHighlight(shownWorking, liveKey);

	const hasShowImage = items.some((item) => item.tools.some((tool) => tool.name === "show_image"));
	const showWrapper = count >= 2 || shownWorking || subagentCount > 0 || hasShowImage;

	const dotsOnSecondRow = shownWorking && dots.length > DOTS_PER_ROW;
	if (!showWrapper) {
		return <div className="-mb-4 flex flex-col gap-1.5">{rows}</div>;
	}

	return (
		<div className="-mb-4">
			<details className="group/outer peer drawer-details">
				<summary className="group/row flex cursor-pointer select-none flex-col [&::-webkit-details-marker]:hidden">
					<div className="flex min-h-6 w-full items-center gap-2 py-0.5">
						{shownWorking ? (
							<>
								<div className="flex shrink-0 items-center gap-2">
									<ThinkingOrb state="working" size={20} paused={false} />
									<span
										ref={labelRef}
										className="sweep-target text-[14px] font-bold text-ink-working transition-colors group-hover/row:text-ink"
									>
										{t(labelKey)}
									</span>
								</div>

								<div ref={tickerWrapRef} className="min-w-0 flex-1 group-open/outer:hidden">
									<PreviewTicker items={liveItems} reserveSpace />
								</div>
							</>
						) : segments.length > 0 ? (
							<span className="min-w-0 truncate text-[13px] text-ink-dim transition-colors group-hover/row:text-ink">
								{segments.map((seg, i) => (
									<Fragment key={seg.key}>
										{i > 0 && <span className="opacity-50"> · </span>}
										{summaryLabel(t, seg)}
									</Fragment>
								))}
							</span>
						) : (
							<span
								ref={labelRef}
								className="text-[14px] font-bold text-ink-dim transition-colors group-hover/row:text-ink"
							>
								{t("message.worked")}
							</span>
						)}

						{dots.length > 0 && !dotsOnSecondRow && (
							<div
								className={`flex items-center gap-1 group-open/outer:hidden ${
									shownWorking ? "ml-auto shrink-0" : "min-w-[7.5rem] flex-1 flex-wrap justify-end"
								}`}
							>
								{dots.map((dot) => (
									<span key={dot.key} className={dotClass(dot.state)} />
								))}
							</div>
						)}
					</div>

					{dotsOnSecondRow && (
						<div className="mb-0.5 flex flex-wrap justify-end gap-1 py-0.5 group-open/outer:hidden">
							{dots.map((dot) => (
								<span key={dot.key} className={dotClass(dot.state)} />
							))}
						</div>
					)}
				</summary>
				<div className="drawer-body">
					<div className="flex flex-col gap-1.5 py-1">{rows}</div>
				</div>
			</details>
		</div>
	);
}, metaGroupPropsEqual);
