import { tailOffsetForWidths } from "@tcode/shared";
import { useLayoutEffect, useRef, useState } from "react";
import { useTypewriter } from "./use-typewriter";

export function StreamingMarquee({ text, active = false }: { text: string; active?: boolean }) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const primaryRef = useRef<HTMLSpanElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<() => void>(() => {});
	const [metrics, setMetrics] = useState({ viewportWidth: 0, textWidth: 0 });
	const overflowing = metrics.textWidth > metrics.viewportWidth;

	const offset = tailOffsetForWidths(metrics.textWidth, metrics.viewportWidth);

	const shown = useTypewriter(text, active);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		const primary = primaryRef.current;
		if (!viewport || !primary) return;
		const measure = () => {
			const next = { viewportWidth: viewport.clientWidth, textWidth: primary.scrollWidth };
			setMetrics((current) =>
				current.viewportWidth === next.viewportWidth && current.textWidth === next.textWidth ? current : next,
			);
		};
		measureRef.current = measure;
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		observer.observe(primary);
		return () => {
			observer.disconnect();
			measureRef.current = () => {};
		};
	}, []);

	useLayoutEffect(() => {
		measureRef.current();
	}, [text]);

	useLayoutEffect(() => {
		if (trackRef.current) trackRef.current.style.transform = `translate3d(-${offset}px, 0, 0)`;
	}, [offset]);

	return (
		<div
			ref={viewportRef}
			className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,transparent,black_4%,black_96%,transparent)]"
		>
			<div ref={trackRef} className={overflowing ? "w-max" : "min-w-0 truncate"}>
				<span ref={primaryRef} className={overflowing ? "block" : "block truncate"}>
					{shown}
				</span>
			</div>
		</div>
	);
}
