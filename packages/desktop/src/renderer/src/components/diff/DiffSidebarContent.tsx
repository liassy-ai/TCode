import { type CheckpointWithDiff, deriveTurnChanges, type TurnChanges } from "@tcode/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useCheckpointsStore } from "../../stores/checkpoints";
import { useSessionsStore } from "../../stores/sessions";
import { useToastsStore } from "../../stores/toasts";
import { useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DiffFileCard } from "./DiffFileCard";

const EMPTY_TURNS: TurnChanges[] = [];

function turnChangeOf(cp: CheckpointWithDiff, turnIndex: number): TurnChanges {
	const files = cp.files.map((f) => ({
		path: f.path,
		added: f.added,
		removed: f.removed,
		sections: f.patch
			? [{ toolCallKey: `cp:${cp.sha}:${f.path}`, kind: "edit" as const, patch: f.patch }]
			: [],
	}));
	return {
		turnIndex,
		checkpointSha: cp.sha,
		files,
		totalAdded: files.reduce((s, f) => s + f.added, 0),
		totalRemoved: files.reduce((s, f) => s + f.removed, 0),
	};
}

function BranchRow() {
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const cwd = useSessionsStore((s) => s.cwd);
	const messages = useTranscriptStore((s) =>
		activeSessionId ? s.bySession[activeSessionId]?.messages : undefined,
	);
	const [branches, setBranches] = useState<string[]>([]);
	const [current, setCurrent] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const hasContent = !!messages && messages.length > 0;

	useEffect(() => {
		if (!cwd || !hasContent) return;
		let cancelled = false;
		void getPi()
			.listGitBranches({ cwd })
			.then((r) => {
				if (cancelled) return;
				setBranches(r.branches);
				setCurrent(r.current);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [cwd, hasContent, open]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const hit = e.target instanceof Element ? e.target.closest("[data-branch-row]") : null;
			if (!hit) setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	if (!hasContent || !cwd || !current || branches.length === 0) return null;

	return (
		<div className="diff-side-branch" data-branch-row>
			<button
				type="button"
				className="diff-branch-btn"
				aria-expanded={open}
				title={current}
				onClick={() => setOpen((v) => !v)}
			>
				<span aria-hidden="true">⎇</span>
				<span className="diff-branch-name">{current}</span>
			</button>
			{open && (
				<div className="diff-branch-pop">
					{branches.map((branch) => {
						const isCurrent = branch === current;
						return (
							<div key={branch} className={`diff-branch-item${isCurrent ? " on" : ""}`} title={branch}>
								<span aria-hidden="true" className="diff-branch-dot" />
								<span className="diff-branch-itemname">{branch}</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

export function DiffSidebarContent() {
	const t = useT();
	const diffFocus = useUiStore((s) => s.diffFocus);
	const clearDiffFocus = useUiStore((s) => s.clearDiffFocus);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const sessionCwd = useSessionsStore((s) => s.cwd);
	const messages = useTranscriptStore((s) =>
		activeSessionId ? s.bySession[activeSessionId]?.messages : undefined,
	);

	const checkpointsVersion = useCheckpointsStore((s) => s.version);

	const [checkpoints, setCheckpoints] = useState<CheckpointWithDiff[]>([]);

	const [loaded, setLoaded] = useState(false);

	const turnLabelOf = useCallback(
		(tc: TurnChanges): string =>
			tc.turnIndex >= 0 ? t("diff.turnLabel", { n: tc.turnIndex + 1 }) : t("diff.baselineLabel"),
		[t],
	);

	const turnChanges = useMemo<TurnChanges[]>(() => {
		if (checkpoints.length === 0) return messages ? deriveTurnChanges(messages) : EMPTY_TURNS;

		return [...checkpoints].reverse().map((cp) => turnChangeOf(cp, cp.turn != null ? cp.turn - 1 : -1));
	}, [checkpoints, messages]);
	const [scope, setScope] = useState<"all" | "latest">("all");
	const visibleTurns = useMemo(
		() => (scope === "latest" ? turnChanges.slice(-1) : turnChanges),
		[turnChanges, scope],
	);

	const canRevert = checkpoints.length > 0;

	const groups = useMemo(() => [...visibleTurns].reverse(), [visibleTurns]);

	const shownTurns = visibleTurns.filter((tc) => tc.turnIndex >= 0);
	const totalFiles = shownTurns.reduce((s, tc) => s + tc.files.length, 0);
	const totalAdded = shownTurns.reduce((s, tc) => s + tc.totalAdded, 0);
	const totalRemoved = shownTurns.reduce((s, tc) => s + tc.totalRemoved, 0);
	const bodyRef = useRef<HTMLDivElement>(null);

	const reloadCheckpoints = useCallback(() => {
		const sid = useSessionsStore.getState().activeSessionId;
		const cwd = useSessionsStore.getState().cwd;
		if (!sid || !cwd) return;
		void getPi()
			.checkpointListWithDiff({ sessionId: sid, cwd })
			.then((list) => {
				if (useSessionsStore.getState().activeSessionId === sid) setCheckpoints(list);
			})
			.catch(() => {});
	}, []);

	useEffect(() => {
		const sid = activeSessionId;
		const cwd = sessionCwd;
		if (!sid || !cwd) return;
		let cancelled = false;
		setLoaded(false);
		void (async () => {
			const list = await getPi()
				.checkpointListWithDiff({ sessionId: sid, cwd })
				.catch(() => [] as CheckpointWithDiff[]);
			if (cancelled || useSessionsStore.getState().activeSessionId !== sid) return;
			setCheckpoints(list);
			setLoaded(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [activeSessionId, sessionCwd]);

	const skipFirstVersion = useRef(true);
	useEffect(() => {
		if (skipFirstVersion.current) {
			skipFirstVersion.current = false;
			return;
		}
		reloadCheckpoints();
	}, [checkpointsVersion, reloadCheckpoints]);

	const [pendingRevert, setPendingRevert] = useState<{ sha: string; label: string } | null>(null);

	const doRevert = useCallback(
		(sha: string, label: string) => {
			const sid = useSessionsStore.getState().activeSessionId;
			const cwd = useSessionsStore.getState().cwd;
			if (!sid || !cwd || !sha) return;
			void getPi()
				.checkpointRestore({ sessionId: sid, cwd, sha })
				.then((res) => {
					useToastsStore
						.getState()
						.push("info", res.changed ? "diff.toastReverted" : "diff.toastRevertNoop", label);
					reloadCheckpoints();
				})
				.catch((err) => {
					console.error("[diff-revert] 回退失败", label, err);
					useToastsStore
						.getState()
						.push("error", "diff.toastRevertFailed", err instanceof Error ? err.message : String(err));
				});
		},
		[reloadCheckpoints],
	);

	useEffect(() => {
		if (!diffFocus) return;
		const inScope = visibleTurns.some((tc) =>
			tc.files.some((f) => f.sections.some((s) => s.toolCallKey === diffFocus.sectionKey)),
		);
		if (!inScope) {
			setScope("all");
			return;
		}
		const el = bodyRef.current?.querySelector(`[data-section-key="${CSS.escape(diffFocus.sectionKey)}"]`);
		const card = el?.closest("details.diff-file-card");
		if (card instanceof HTMLDetailsElement) {
			card.open = true;
			card.scrollIntoView({
				block: "center",
				behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
			});
			card.classList.remove("jump-flash");
			void card.offsetWidth;
			card.classList.add("jump-flash");
			setTimeout(() => card.classList.remove("jump-flash"), 1200);
		}
		clearDiffFocus();
	}, [diffFocus, visibleTurns, clearDiffFocus]);

	return (
		<div className="diff-sidebar-in">
			<div className="diff-side-head">
				<span className="diff-side-title">{t("diff.title")}</span>
				<span className="diff-side-sum">
					{loaded && (
						<>
							{t("diff.filesSummary", { count: totalFiles })} ·{" "}
							<span className="turn-diff-added">+{totalAdded}</span>{" "}
							<span className="turn-diff-removed">−{totalRemoved}</span>
						</>
					)}
				</span>
				<div className="diff-seg" role="tablist">
					<button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
						{t("diff.scopeAll")}
					</button>
					<button type="button" className={scope === "latest" ? "on" : ""} onClick={() => setScope("latest")}>
						{t("diff.scopeLatest")}
					</button>
				</div>
			</div>
			<BranchRow />
			<div className="diff-side-scroll" ref={bodyRef}>
				{!loaded && <div className="diff-side-empty">{t("diff.gitLoading")}</div>}

				{loaded &&
					(totalFiles === 0 ? (
						<div className="diff-side-empty">{t("diff.empty")}</div>
					) : (
						groups.map((tc, gi) => {
							if (tc.turnIndex < 0) return null;

							const target = groups[gi + 1] ?? tc;
							return (
								<details className="diff-turn-group drawer-details" key={tc.checkpointSha ?? tc.turnIndex}>
									<summary className="diff-tg-head">
										<span className="diff-tg-title">{turnLabelOf(tc)}</span>
										<span className="diff-tg-sum">
											<span className="turn-diff-added">+{tc.totalAdded}</span>{" "}
											<span className="turn-diff-removed">−{tc.totalRemoved}</span>
										</span>
										{canRevert && (
											<button
												type="button"
												className="diff-tg-revert"
												onClick={(e) => {
													e.preventDefault();
													e.stopPropagation();

													const sha = target.checkpointSha ?? "";
													if (sha) setPendingRevert({ sha, label: turnLabelOf(target) });
												}}
											>
												{t("diff.revert")}
											</button>
										)}
										<span className="diff-tg-chev" aria-hidden="true">
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
										<div className="diff-tg-body">
											{tc.files.map((f, fi) => (
												<DiffFileCard
													key={`${tc.turnIndex}:${f.path}`}
													file={f}
													cwd={sessionCwd}
													defaultOpen={gi === 0 && fi === 0}
												/>
											))}
										</div>
									</div>
								</details>
							);
						})
					))}
			</div>
			{pendingRevert && (
				<ConfirmDialog
					title={t("diff.revertTitle", { label: pendingRevert.label })}
					description={t("diff.revertConfirm")}
					confirmLabel={t("diff.revert")}
					cancelLabel={t("common.cancel")}
					danger
					onConfirm={() => {
						const p = pendingRevert;
						setPendingRevert(null);
						if (p) doRevert(p.sha, p.label);
					}}
					onCancel={() => setPendingRevert(null)}
				/>
			)}
		</div>
	);
}
