import { type RefObject, useEffect } from "react";

export function useSidebarFill(ref: RefObject<HTMLElement | null>, floating: boolean): void {
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const apply = () => {
			const width = floating ? 0 : Math.round(element.getBoundingClientRect().width);
			document.documentElement.style.setProperty("--sidebar-fill", `${width}px`);
		};
		apply();
		const observer = new ResizeObserver(apply);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, floating]);
}
