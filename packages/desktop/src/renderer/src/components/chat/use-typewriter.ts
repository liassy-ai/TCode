import { useEffect, useRef, useState } from "react";

const MIN_CPS = 60;
const MAX_CPS = 240;
const BACKLOG_LATENCY_MS = 700;
const MAX_CHARS_PER_COMMIT = 6;
const MIN_FRAME_MS = 1000 / 240;
const EWMA_ALPHA = 0.35;

let segmenter: Intl.Segmenter | undefined;
function getSegmenter(): Intl.Segmenter {
	if (!segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	return segmenter;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function useTypewriter(source: string, active: boolean): string {
	const pacedRef = useRef<boolean>(active);
	const paced = pacedRef.current;

	const sourceRef = useRef(source);
	sourceRef.current = source;

	const stateRef = useRef({
		visible: paced ? "" : source,
		arrivalCps: MIN_CPS,
		lastSrcLen: paced ? 0 : source.length,
		budget: 0,
		lastTick: 0,
	});
	const [visible, setVisible] = useState(stateRef.current.visible);

	useEffect(() => {
		if (!paced || !active) return;
		const st = stateRef.current;
		let raf = 0;
		const tick = (ts: number) => {
			raf = requestAnimationFrame(tick);
			const src = sourceRef.current;

			if (!src.startsWith(st.visible)) {
				st.visible = src;
				st.arrivalCps = MIN_CPS;
				st.lastSrcLen = src.length;
				st.budget = 0;
				setVisible(src);
				return;
			}
			if (st.lastTick === 0) {
				st.lastTick = ts;
				st.lastSrcLen = src.length;
				return;
			}
			const dt = Math.min(100, Math.max(0, ts - st.lastTick));
			if (dt < MIN_FRAME_MS) return;
			st.lastTick = ts;

			const delta = src.length - st.lastSrcLen;
			st.lastSrcLen = src.length;
			if (delta > 0) {
				const inst = delta / (dt / 1000);
				st.arrivalCps += (inst - st.arrivalCps) * EWMA_ALPHA;
			}
			const pending = src.length - st.visible.length;
			if (pending <= 0) {
				st.budget = 0;
				return;
			}

			const backlogCps = pending / (BACKLOG_LATENCY_MS / 1000);
			const targetCps = clamp(Math.max(st.arrivalCps, backlogCps), MIN_CPS, MAX_CPS);
			st.budget += targetCps * (dt / 1000);
			if (st.budget < 1) return;
			const want = Math.min(Math.floor(st.budget), MAX_CHARS_PER_COMMIT);
			let added = "";
			let n = 0;
			for (const seg of getSegmenter().segment(src.slice(st.visible.length))) {
				added += seg.segment;
				if (++n >= want) break;
			}
			if (added) {
				st.visible += added;
				st.budget = Math.max(0, st.budget - n);
				setVisible(st.visible);
			}
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [paced, active]);

	return paced && active ? visible : source;
}
