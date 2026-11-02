export function tailOffsetForWidths(textWidth: number, viewportWidth: number): number {
	if (!Number.isFinite(textWidth) || !Number.isFinite(viewportWidth)) return 0;
	return Math.max(0, textWidth - viewportWidth);
}
