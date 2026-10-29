export interface FileReadRequest {
	cwd: string;

	path: string;

	maxBytes?: number;
}

export interface FileReadResult {
	path: string;

	content: string | null;

	size: number;

	truncated: boolean;

	binary: boolean;
	isDirectory: boolean;

	invalidUtf8: number;
}

export const FS_READ_DEFAULT_MAX_BYTES = 1_000_000;

export const FS_READ_HARD_MAX_BYTES = 5_000_000;
