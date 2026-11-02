export const INITIAL_MOUNTED_ROWS = 40;

export const MOUNT_CHUNK_ROWS = 30;

export const MOUNT_TRIGGER_PX = 1000;

export function tailWindowStart(totalRows: number): number {
	if (!Number.isFinite(totalRows)) return 0;
	return Math.max(0, Math.floor(totalRows) - INITIAL_MOUNTED_ROWS);
}

export function clampWindowStart(start: number, totalRows: number): number {
	if (!Number.isFinite(start) || start <= 0) return 0;
	if (start >= totalRows) return tailWindowStart(totalRows);
	return Math.floor(start);
}

export function expandWindowStart(start: number, totalRows: number): number {
	if (!Number.isFinite(start) || start <= 0) return 0;
	return clampWindowStart(Math.max(0, Math.floor(start) - MOUNT_CHUNK_ROWS), totalRows);
}

export const RETAIN_ABOVE_PX = 2400;

export const RECLAIM_TRIGGER_PX = 3600;

export const RECLAIM_PROBE_PX = 800;

export function reclaimWindowStart(firstKeepRow: number, totalRows: number): number {
	return clampWindowStart(Math.max(0, Math.floor(firstKeepRow)), totalRows);
}
