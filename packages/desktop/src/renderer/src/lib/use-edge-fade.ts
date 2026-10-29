import { type RefObject, useEffect } from "react";

export function useEdgeFade(ref: RefObject<HTMLElement | null>, edges: EdgeFadeEdges = "both"): void {
	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		let frame = 0;

		const schedule = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				syncEdgeFade(el, edges);
			});
		};

		syncEdgeFade(el, edges);
		el.addEventListener("scroll", schedule, { passive: true });
		const resizeObserver = new ResizeObserver(schedule);
		resizeObserver.observe(el);
		const mutationObserver = new MutationObserver(schedule);
		mutationObserver.observe(el, { childList: true, subtree: true });

		return () => {
			if (frame) cancelAnimationFrame(frame);
			el.removeEventListener("scroll", schedule);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	}, [ref, edges]);
}

export type EdgeFadeEdges = "both" | "top" | "bottom";

export function syncEdgeFade(el: HTMLElement, edges: EdgeFadeEdges = "both"): void {
	const wantsTop = edges !== "bottom";
	const wantsBottom = edges !== "top";
	if (!wantsTop) delete el.dataset.fadeTop;
	if (!wantsBottom) delete el.dataset.fadeBottom;
	if (el.scrollHeight - el.clientHeight <= 1) {
		delete el.dataset.fadeTop;
		delete el.dataset.fadeBottom;
		return;
	}

	if (wantsTop) el.dataset.fadeTop = el.scrollTop > 1 ? "true" : "false";
	if (wantsBottom)
		el.dataset.fadeBottom = el.scrollHeight - el.clientHeight - el.scrollTop > 1 ? "true" : "false";
}
