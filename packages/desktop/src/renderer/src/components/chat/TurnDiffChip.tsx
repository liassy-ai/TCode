import type { TurnChanges, TurnTiming } from "@tcode/shared";
import { useState } from "react";
import { useT } from "../../i18n";
import { openDiffTab } from "../../sidepane/openers";
import { useSessionsStore } from "../../stores/sessions";
import { useUiStore } from "../../stores/ui";
import { ClockIcon, MoreIcon } from "../icons";
import { FilePathMenu } from "../ui/FilePathMenu";
import { anchorOfElement, type MenuAnchor } from "../ui/place-menu";

const pluralUnit = (n: number, one: string, many: string) => (n === 1 ? one : many);

function formatDuration(ms: number): string {
	const total = Math.floor(ms / 1000);
	if (total < 60) return `${total}s`;
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
	return `${m}m ${String(s).padStart(2, "0")}s`;
}

function TurnTimer({ timing }: { timing: TurnTiming }) {
	const t = useT();
	const elapsed = timing.endedAt !== undefined ? Math.max(0, timing.endedAt - timing.startedAt) : null;
	if (elapsed === null) return null;
	return (
		<span
			role="timer"
			className="turn-diff-timer"
			aria-label={t("diff.workedFor", { duration: formatDuration(elapsed) })}
		>
			<ClockIcon size={12} />
			<span className="turn-diff-timer-num">{formatDuration(elapsed)}</span>
		</span>
	);
}

export function TurnDiffChip({
	changes,
	timing,
	running,
	entering,
}: {
	changes?: TurnChanges;
	timing?: TurnTiming;
	running: boolean;
	entering: boolean;
}) {
	const t = useT();
	const setDiffFocus = useUiStore((s) => s.setDiffFocus);

	const cwd = useSessionsStore((s) => s.cwd);

	const [menu, setMenu] = useState<{ path: string; anchor: MenuAnchor } | null>(null);
	const enterCls = entering ? " turn-diff-enter" : "";

	if (running) return null;

	if (!changes) {
		return timing ? (
			<div className={`turn-diff-plain${enterCls}`}>
				<TurnTimer timing={timing} />
			</div>
		) : null;
	}

	const jumpTo = (sectionKey?: string) => {
		openDiffTab();
		if (sectionKey) setDiffFocus(sectionKey);
	};
	const fileCount = changes.files.length;

	return (
		<details className={`turn-diff drawer-details${enterCls}`}>
			<summary className="turn-diff-head">
				{timing && (
					<>
						<TurnTimer timing={timing} />
						<span className="turn-diff-sep" aria-hidden="true">
							·
						</span>
					</>
				)}
				<span className="turn-diff-title">
					{t("diff.filesChanged", { count: fileCount, unit: pluralUnit(fileCount, "file", "files") })}
				</span>
				<span className="turn-diff-stat turn-diff-added">+{changes.totalAdded}</span>
				<span className="turn-diff-stat turn-diff-removed">−{changes.totalRemoved}</span>
				<span className="turn-diff-chev" aria-hidden="true">
					<svg
						width="11"
						height="11"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="m9 6 6 6-6 6" />
					</svg>
				</span>
			</summary>
			<div className="drawer-body">
				<div className="turn-diff-files">
					{changes.files.map((f) => (
						<button
							key={f.path}
							type="button"
							className="turn-diff-file"
							onClick={() => jumpTo(f.sections[0]?.toolCallKey)}
							onContextMenu={(e) => {
								e.preventDefault();
								setMenu({ path: f.path, anchor: anchorOfElement(e.currentTarget) });
							}}
						>
							<span className="turn-diff-path" title={f.path}>
								{`\u200e${f.path}`}
							</span>
							<span className="turn-diff-stat">
								<span className="turn-diff-added">+{f.added}</span>{" "}
								<span className="turn-diff-removed">−{f.removed}</span>
							</span>

							<span
								className="turn-diff-more"
								aria-hidden="true"
								onClick={(e) => {
									e.stopPropagation();
									setMenu({ path: f.path, anchor: anchorOfElement(e.currentTarget) });
								}}
							>
								<MoreIcon />
							</span>
						</button>
					))}
				</div>
			</div>
			{menu && (
				<FilePathMenu target={menu.path} cwd={cwd} anchor={menu.anchor} onClose={() => setMenu(null)} />
			)}
		</details>
	);
}
