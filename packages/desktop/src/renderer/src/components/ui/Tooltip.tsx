import type { ReactNode } from "react";

export function Tooltip({
	label,
	align = "center",
	className,
	children,
}: {
	label: string;

	align?: "center" | "end";

	className?: string;
	children: ReactNode;
}) {
	return (
		<span className={`group/tooltip relative inline-flex shrink-0 ${className ?? ""}`}>
			{children}
			<span
				role="tooltip"
				className={`pointer-events-none absolute top-full z-50 mt-1.5 whitespace-nowrap rounded-md bg-white px-2 py-1 text-[11px] text-ink opacity-0 shadow-pop transition-opacity duration-150 group-hover/tooltip:opacity-100 group-hover/tooltip:delay-300 dark:bg-black ${
					align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"
				}`}
			>
				{label}
			</span>
		</span>
	);
}
