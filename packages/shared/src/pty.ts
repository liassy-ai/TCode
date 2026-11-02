export interface PtyCreateRequest {
	cwd: string;
	cols: number;
	rows: number;
}

export interface PtyDataEvent {
	id: string;
	data: string;
}

export interface PtyExitEvent {
	id: string;
	exitCode: number | null;
}

export const PTY_MAX_SESSIONS = 32;
