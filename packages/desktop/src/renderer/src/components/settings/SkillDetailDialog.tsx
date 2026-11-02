import { type LoadedSkill, type ResourceScope, skillDisplayName } from "@tcode/shared";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { errText } from "../../lib/error-text";
import { useSettingsStore } from "../../stores/settings";
import { useToastsStore } from "../../stores/toasts";
import { CloseIcon } from "../icons";
import { ConfirmDialog } from "../ui/ConfirmDialog";

function ScopeBadge({ scope, system }: { scope: ResourceScope; system?: boolean }) {
	const t = useT();
	if (system) {
		return (
			<span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
				{t("settings.skills.scopeSystem")}
			</span>
		);
	}
	const key =
		scope === "project"
			? "settings.skills.scopeProject"
			: scope === "temporary"
				? "settings.skills.scopeTemporary"
				: "settings.skills.scopeUser";
	return (
		<span
			className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
				scope === "project" ? "bg-accent/10 text-accent" : "bg-hover text-ink-2"
			}`}
		>
			{t(key)}
		</span>
	);
}

export function SkillDetailDialog({ skill, onClose }: { skill: LoadedSkill; onClose: () => void }) {
	const t = useT();
	const [content, setContent] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;
		getPi()
			.readSkillFile({ path: skill.path })
			.then((text) => {
				if (!cancelled) setContent(text);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [skill.path]);

	useEffect(() => {
		if (confirming) return;
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current?.contains(e.target as Node)) return;
			onClose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [onClose, confirming]);

	const badge = !skill.disableModelInvocation
		? null
		: skill.defaultDisabled
			? t("settings.skills.defaultDisabled")
			: t("settings.skills.manualOnly");

	const doDelete = async () => {
		setConfirming(false);
		setDeleting(true);
		try {
			await getPi().deleteUserSkill({ path: skill.path });
			useToastsStore.getState().push("info", "settings.skills.deleted", skill.path);

			await useSettingsStore.getState().refreshResources();
			onClose();
		} catch (err) {
			useToastsStore.getState().push("error", "settings.skills.deleteFailed", errText(err));
		} finally {
			setDeleting(false);
		}
	};

	return createPortal(
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/20" role="presentation">
			<div
				ref={ref}
				role="dialog"
				aria-modal="true"
				aria-label={skillDisplayName(skill.name)}
				className="relative flex max-h-[80vh] w-[560px] flex-col rounded-2xl border border-border bg-surface px-[22px] pt-5 pb-4 shadow-dialog"
			>
				<div className="flex items-center gap-2">
					<h2 className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em] text-ink">
						{skillDisplayName(skill.name)}
					</h2>
					{badge && (
						<span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-faint">{badge}</span>
					)}
					<ScopeBadge scope={skill.scope} system={skill.systemSkill} />
					<button
						type="button"
						className="ml-1 flex shrink-0 text-ink-faint transition-colors hover:text-ink-2"
						onClick={onClose}
						aria-label={t("common.close")}
					>
						<CloseIcon size={14} />
					</button>
				</div>
				<p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{skill.description}</p>
				<p className="mt-1 break-all font-mono text-[10px] text-ink-faint">{skill.path}</p>
				<div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-hover/40 p-3">
					{error ? (
						<p className="text-[12px] text-red-500">{t("settings.skills.detailLoadFailed")}</p>
					) : content === null ? (
						<p className="text-[12px] text-ink-faint">{t("settings.skills.loading")}</p>
					) : (
						<pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2">
							{content}
						</pre>
					)}
				</div>
				{error && <p className="mt-1 font-mono text-[10px] text-ink-faint">{error}</p>}
				{skill.scope === "user" && !skill.systemSkill && (
					<div className="mt-3 flex justify-end">
						<button
							type="button"
							className="flex h-8 items-center rounded-[9px] px-3.5 text-[13px] text-red-500 transition-colors hover:bg-red-600/10 disabled:opacity-40"
							disabled={deleting || content === null}
							onClick={() => setConfirming(true)}
						>
							{t("common.delete")}
						</button>
					</div>
				)}
			</div>
			{confirming && (
				<ConfirmDialog
					title={t("settings.skills.deleteTitle")}
					description={t("settings.skills.deleteDesc", { name: skillDisplayName(skill.name) })}
					confirmLabel={t("common.delete")}
					cancelLabel={t("common.cancel")}
					danger
					onConfirm={() => void doDelete()}
					onCancel={() => setConfirming(false)}
				/>
			)}
		</div>,
		document.body,
	);
}
