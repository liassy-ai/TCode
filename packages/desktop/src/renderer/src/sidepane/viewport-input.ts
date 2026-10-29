export const VIEWPORT_MIN_PX = 200;
export const VIEWPORT_MAX_PX = 10000;

export interface ViewportSize {
	width: number;
	height: number;
}

export interface ViewportSizeDraft {
	width: string;
	height: string;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function parseViewportSize(text: string): number | null {
	const value = Number.parseFloat(text.trim());
	if (!Number.isFinite(value)) return null;
	return clamp(Math.round(value), VIEWPORT_MIN_PX, VIEWPORT_MAX_PX);
}

export function formatPercent(scale: number): string {
	return String(Math.round(clamp(scale, 0.05, 10) * 100));
}

export function resolveViewportSize(draft: ViewportSizeDraft, current: ViewportSize): ViewportSize {
	return {
		width: parseViewportSize(draft.width) ?? current.width,
		height: parseViewportSize(draft.height) ?? current.height,
	};
}
