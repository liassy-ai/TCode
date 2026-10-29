import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";
import { type MenuAnchor, placeMenu } from "../ui/place-menu";

const EXIT_MS = 120;

export function RenamePopover({
	anchor,
	value,
	onCommit,
	onCancel,
}: {
	anchor: MenuAnchor;
	value: string;
	onCommit: (name: string) => void;
	onCancel: () => void;
}) {
	const t = useT();
	const [text, setText] = useState(value);

	const [closing, setClosing] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

	useEffect(() => {
		const id = requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
		return () => cancelAnimationFrame(id);
	}, []);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		setPos(
			placeMenu(
				anchor,
				{ width, height },
				{ width: window.innerWidth, height: window.innerHeight },
				{ gap: 8 },
			),
		);
	}, [anchor]);

	const finish = (commit: boolean) => {
		if (closing) return;
		setClosing(true);

		window.setTimeout(() => {
			if (commit) onCommit(text.trim());
			else onCancel();
		}, EXIT_MS);
	};

	const finishRef = useRef(finish);
	finishRef.current = finish;

	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current?.contains(e.target as Node)) return;

			finishRef.current(true);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				finishRef.current(false);
			}
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, []);

	return createPortal(
		<div
			ref={ref}
			className={`no-drag fixed z-50 w-[264px] rounded-xl bg-surface p-2.5 shadow-dialog ${
				closing ? "pop-out" : "pop-in"
			}`}
			style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? "visible" : "hidden" }}
		>
			<input
				ref={inputRef}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") finish(true);
				}}
				placeholder={t("tabbar.renamePlaceholder")}
				className="w-full rounded-lg bg-hover px-2.5 py-[7px] text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
			/>
			<div className="mt-2 flex justify-end gap-0.5">
				<button
					type="button"
					className="rounded-lg px-2 py-1 text-[13px] text-ink-faint transition-colors hover:bg-hover hover:text-ink-2"
					onClick={() => finish(false)}
				>
					{t("common.cancel")}
				</button>
				<button
					type="button"
					className="rounded-lg px-2 py-1 text-[13px] font-medium text-ink transition-colors hover:bg-hover"
					onClick={() => finish(true)}
				>
					{t("tabbar.rename")}
				</button>
			</div>
		</div>,
		document.body,
	);
}
