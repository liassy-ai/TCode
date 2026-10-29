import { useLayoutEffect, useRef, useState } from "react";

const RESTORE_GAP_PX = 4;

const SLACK_MIN_PX = 2;

const SUFFIX_GAP_PX = 8;

const PERM_GAP_PX = 4;

export function footerRestoreSlackPx(root: HTMLElement): number {
	const FLOOR_SLACK_PX = 16;
	let width = FLOOR_SLACK_PX;

	const groups: Array<[string, number]> = [
		["suffix", SUFFIX_GAP_PX],
		["perm", PERM_GAP_PX],
	];
	for (const [group, gapPx] of groups) {
		let hidden = 0;
		for (const piece of root.querySelectorAll<HTMLElement>('[data-compact-piece="' + group + '"]')) {
			if (getComputedStyle(piece).position !== "absolute") continue;
			hidden += piece.getBoundingClientRect().width;
		}
		if (hidden > 0) width += hidden + gapPx;
	}
	return width;
}

export function useFooterCompact() {
	const rowRef = useRef<HTMLDivElement>(null);
	const [stage, setStage] = useState<0 | 1 | 2>(0);

	useLayoutEffect(() => {
		const row = rowRef.current;
		const name = row?.querySelector<HTMLElement>("[data-model-name]");
		const spacer = row?.querySelector<HTMLElement>("[data-footer-spacer]");
		const chip = name?.closest("button") ?? null;
		if (!row || !name || !spacer) return;
		const cost = (group: string, gapPx: number) => {
			let width = gapPx;
			for (const piece of row.querySelectorAll<HTMLElement>(`[data-compact-piece="${group}"]`)) {
				width += piece.getBoundingClientRect().width;
			}
			return width;
		};
		const check = () => {
			const spacerWidth = spacer.getBoundingClientRect().width;
			const tight = spacerWidth < SLACK_MIN_PX;

			const withTexts = (costPx: number) => {
				const byRow = name.clientWidth + spacerWidth - costPx;
				if (!chip) return byRow;
				const cap = Number.parseFloat(getComputedStyle(chip).maxWidth);

				const other = chip.clientWidth - name.clientWidth;
				return Number.isFinite(cap) ? Math.min(byRow, cap - other - costPx) : byRow;
			};
			if (stage === 0) {
				if (tight) setStage(1);
				return;
			}
			if (stage === 1) {
				if (tight) {
					setStage(2);
					return;
				}
				if (withTexts(cost("suffix", SUFFIX_GAP_PX)) >= name.scrollWidth + RESTORE_GAP_PX) {
					setStage(0);
				}
				return;
			}
			if (withTexts(cost("perm", PERM_GAP_PX)) >= name.scrollWidth + RESTORE_GAP_PX) setStage(1);
		};
		check();
		const ro = new ResizeObserver(check);
		ro.observe(row);
		ro.observe(name);
		ro.observe(spacer);
		return () => ro.disconnect();
	}, [stage]);

	return { rowRef, stage };
}
