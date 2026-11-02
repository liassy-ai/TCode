export const SIDEBAR_MIN_WIDTH_PX = 200;

export const SIDEBAR_MAX_WIDTH_PX = 380;

export const SIDEBAR_DEFAULT_WIDTH_PX = 240;

export function clampSidebarWidth(width: number): number {
	if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH_PX;
	return Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, Math.round(width)));
}

export let SIDEBAR_WIDTH_PX = SIDEBAR_DEFAULT_WIDTH_PX;

export function setSidebarWidthPx(width: number): number {
	SIDEBAR_WIDTH_PX = clampSidebarWidth(width);
	return SIDEBAR_WIDTH_PX;
}
