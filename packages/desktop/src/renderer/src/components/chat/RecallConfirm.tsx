import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";
import { useRecallConfirmStore } from "../../stores/recall-confirm";
import { FileTypeIcon } from "../icons";
import { type MenuAnchor, placeMenu } from "../ui/place-menu";

export function RecallConfirm() {
	const t = useT();
	const files = useRecallConfirmStore((s) => s.files);
	const anchor = useRecallConfirmStore((s) => s.anchor);
	const settle = useRecallConfirmStore((s) => s.settle);
	const ref = useRef<HTMLDivElement>(null);

	const [measured, setMeasured] = useState<{ anchor: MenuAnchor; x: number; y: number } | null>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el || !anchor) return;
		const { width, height } = el.getBoundingClientRect();

		const { x, y } = placeMenu(
			anchor,
			{ width, height },
			{ width: window.innerWidth, height: window.innerHeight },
			{ align: "end", gap: 6 },
		);
		setMeasured({ anchor, x, y });
	}, [anchor]);
	const pos = measured && measured.anchor === anchor ? measured : null;

	useEffect(() => {
		if (files === null) return;
		const cancel = () => settle(false);
		const onPointerDown = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) settle(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") settle(false);
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("resize", cancel);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("resize", cancel);
		};
	}, [files, settle]);

	if (files === null || !anchor) return null;
	return createPortal(
		<div
			ref={ref}
			role="dialog"
			aria-modal="true"
			aria-label={t("message.recallConfirmTitle", { count: files.length })}
			className="menu-pop no-drag fixed z-[60] w-[288px] rounded-xl border border-border bg-surface p-1 shadow-pop"
			style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? "visible" : "hidden" }}
		>
			<div className="px-2 pt-[7px] pb-1.5 text-[13px] text-ink-2">
				<span className="block truncate">
					{files.length > 0
						? t("message.recallConfirmTitle", { count: files.length })
						: t("message.recallConfirmGeneric")}
				</span>
			</div>
			{files.length > 0 && (
				<ul className="mb-1 max-h-40 overflow-y-auto border-t border-border px-2 pt-1">
					{files.map((f) => (
						<li key={f} className="flex items-center gap-1.5 text-[12px] leading-5 text-ink-dim" title={f}>
							<span className="flex shrink-0">
								<FileTypeIcon path={f} size={12} />
							</span>
							<span className="truncate">{f}</span>
						</li>
					))}
				</ul>
			)}
			<div className="flex justify-end gap-2 border-t border-border px-2 pt-2 pb-1">
				<button
					type="button"
					className="flex h-8 items-center rounded-[9px] px-3.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
					onClick={() => settle(false)}
				>
					{t("common.cancel")}
				</button>
				<button
					type="button"
					className="flex h-8 items-center rounded-[9px] bg-red-600/12 px-3.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-600/20"
					onClick={() => settle(true)}
				>
					{t("message.recall")}
				</button>
			</div>
		</div>,
		document.body,
	);
}
