import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useUpdateStore } from "../../stores/update";

const inputCls =
	"h-8 w-full rounded-lg border border-border bg-surface-solid px-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-border-strong";

export function BugReportDialog({ onClose }: { onClose: () => void }) {
	const t = useT();
	const current = useUpdateStore((s) => s.current);
	const [kind, setKind] = useState<"bug" | "suggestion">("bug");
	const [title, setTitle] = useState("");
	const [content, setContent] = useState("");
	const [contact, setContact] = useState("");
	const [sending, setSending] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
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
	}, [onClose]);

	const canSubmit = content.trim() !== "" && !sending;

	const submit = () => {
		if (!canSubmit) return;
		setSending(true);
		void getPi()
			.pluginCommand({
				cmd: `bug-report:${JSON.stringify({
					kind,
					title: title.trim(),
					content: content.trim(),
					contact: contact.trim(),
					version: current,
					platform: getPi().platform,
				})}`,
			})
			.then(() => onClose())
			.catch(() => setSending(false));
	};

	return createPortal(
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/20" role="presentation">
			<div
				ref={ref}
				role="dialog"
				aria-modal="true"
				aria-label={t("settings.bugTitle")}
				className="relative w-[560px] max-w-[calc(100vw-48px)] rounded-2xl border border-border bg-surface px-[22px] pt-5 pb-4 shadow-dialog"
			>
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h2 className="text-[15px] font-semibold text-ink">{t("settings.bugTitle")}</h2>
						<p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{t("settings.bugHint")}</p>
					</div>
					<div className="flex shrink-0 rounded-lg border border-border p-[2px]">
						{(
							[
								{ v: "bug", label: t("settings.bugKindBug") },
								{ v: "suggestion", label: t("settings.bugKindSuggestion") },
							] as const
						).map((k) => (
							<button
								key={k.v}
								type="button"
								onClick={() => setKind(k.v)}
								className={`rounded-md px-3 py-[3px] text-[12px] transition-colors ${
									kind === k.v ? "bg-ink text-on-ink" : "text-ink-faint hover:text-ink"
								}`}
							>
								{k.label}
							</button>
						))}
					</div>
				</div>

				<div className="mt-4 grid grid-cols-2 gap-3">
					<label className="flex min-w-0 flex-col gap-1.5">
						<span className="text-[12px] text-ink-dim">{t("settings.bugTitleLabel")}</span>
						<input
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							maxLength={120}
							placeholder={t("settings.bugTitlePlaceholder")}
							className={inputCls}
						/>
					</label>
					<label className="flex min-w-0 flex-col gap-1.5">
						<span className="text-[12px] text-ink-dim">{t("settings.bugContactLabel")}</span>
						<input
							value={contact}
							onChange={(e) => setContact(e.target.value)}
							maxLength={120}
							placeholder={t("settings.bugContactPlaceholder")}
							className={inputCls}
						/>
					</label>
				</div>

				<label className="mt-3 flex flex-col gap-1.5">
					<span className="flex items-baseline justify-between gap-2">
						<span className="text-[12px] text-ink-dim">{t("settings.bugContentLabel")}</span>
						<span className="text-[11px] tabular-nums text-ink-faint">{content.length}/4000</span>
					</span>
					<textarea
						value={content}
						onChange={(e) => setContent(e.target.value)}
						maxLength={4000}
						rows={6}
						placeholder={t("settings.bugContentPlaceholder")}
						className="w-full resize-y rounded-lg border border-border bg-surface-solid px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-border-strong"
					/>
				</label>

				<div className="mt-4 flex items-center justify-between gap-2">
					<span className="min-w-0 text-[11.5px] text-ink-faint">
						{content.trim() === "" ? t("settings.bugContentRequired") : ""}
					</span>
					<div className="flex shrink-0 items-center gap-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-border-strong hover:bg-hover"
						>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							disabled={!canSubmit}
							onClick={submit}
							className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] text-on-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{sending ? t("settings.bugSending") : t("settings.bugSubmit")}
						</button>
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
