import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../icons";

export function ConfirmDialog({
	title,
	description,
	confirmLabel,
	cancelLabel,
	closeLabel,
	danger = false,
	autoFocusConfirm = false,
	onConfirm,
	onCancel,
}: {
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel: string;

	closeLabel?: string;

	danger?: boolean;

	autoFocusConfirm?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const confirmRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (autoFocusConfirm) confirmRef.current?.focus();
	}, [autoFocusConfirm]);

	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current?.contains(e.target as Node)) return;
			onCancel();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [onCancel]);

	return createPortal(
		<div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/6" role="presentation">
			<div
				ref={ref}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="relative w-[392px] rounded-2xl border border-border bg-surface px-[22px] pt-5 pb-4 shadow-dialog"
			>
				<h2 className="pr-6 text-[19px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
				<p className="mt-2 text-[13px] leading-[1.7] text-ink-dim">{description}</p>
				<button
					type="button"
					className="absolute top-4 right-4 flex text-ink-faint transition-colors hover:text-ink-2"
					onClick={onCancel}
					aria-label={closeLabel ?? cancelLabel}
				>
					<CloseIcon size={14} />
				</button>
				<div className="mt-[18px] flex justify-end gap-2">
					<button
						type="button"
						className="flex h-8 items-center rounded-[9px] px-3.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
						onClick={onCancel}
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						className={`flex h-8 items-center rounded-[9px] px-3.5 text-[13px] font-medium transition-colors ${
							danger ? "bg-red-600/12 text-red-600 hover:bg-red-600/20" : "bg-ink text-on-ink hover:bg-ink-2"
						}`}
						ref={confirmRef}
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
