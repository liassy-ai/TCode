import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "../icons";

const MENU_BASE =
	"absolute z-30 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-pop";

const TRIGGER_BASE =
	"flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-hover hover:text-ink";

export function Dropdown({
	trigger,
	children,
	direction = "up",
	align = "center",
	menuClassName = "w-56",
	triggerClassName = TRIGGER_BASE,
}: {
	trigger: React.ReactNode;
	children: (close: () => void) => React.ReactNode;

	direction?: "up" | "down";

	align?: "start" | "center" | "end";

	menuClassName?: string;

	triggerClassName?: string;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	const vertical = direction === "up" ? "bottom-full mb-1" : "top-full mt-1";
	const horizontal =
		align === "center" ? "left-1/2 -translate-x-1/2" : align === "start" ? "left-0" : "right-0";

	return (
		<div ref={ref} className="relative">
			<button type="button" className={triggerClassName} onClick={() => setOpen((v) => !v)}>
				{trigger}
				<ChevronDownIcon />
			</button>
			{open && (
				<div className={`${MENU_BASE} ${vertical} ${horizontal} ${menuClassName}`}>
					{children(() => setOpen(false))}
				</div>
			)}
		</div>
	);
}
