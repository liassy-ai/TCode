import { SIDEPANE_MIN_WIDTH_PX } from "@tcode/shared";

export function sidePaneMaxWidthPx(viewportPx: number, leftRailPx: number, chatFloorPx: number): number {
	const viewportCap = Math.round((viewportPx * 2) / 3);
	const chatCap = viewportPx - leftRailPx - chatFloorPx;
	return Math.max(SIDEPANE_MIN_WIDTH_PX, Math.min(viewportCap, chatCap));
}
