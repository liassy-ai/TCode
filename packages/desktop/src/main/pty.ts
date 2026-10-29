import { randomUUID } from "node:crypto";
import type { PtyCreateRequest, PtyDataEvent, PtyExitEvent } from "@tcode/shared";
import { PTY_MAX_SESSIONS } from "@tcode/shared";
import {
	createComponentPty,
	killComponentPty,
	resizeComponentPty,
	writeComponentPty,
} from "./component-bridge";

export type PtySend = (channel: "pty:data" | "pty:exit", payload: PtyDataEvent | PtyExitEvent) => void;

interface PtySession {
	id: string;
}

export class PtyManager {
	private readonly sessions = new Map<string, PtySession>();

	constructor(private readonly send: PtySend) {}

	async create(request: PtyCreateRequest): Promise<{ id: string }> {
		while (this.sessions.size >= PTY_MAX_SESSIONS) {
			const oldest = this.sessions.values().next().value as PtySession | undefined;
			if (!oldest) break;
			this.sessions.delete(oldest.id);
			killComponentPty(oldest.id);
		}

		const id = randomUUID();
		this.sessions.set(id, { id });
		const ok = await createComponentPty(
			{
				ptyId: id,
				cwd: request.cwd,
				cols: Math.max(2, request.cols),
				rows: Math.max(1, request.rows),
			},
			{
				onData: (data) => this.send("pty:data", { id, data } satisfies PtyDataEvent),
				onExit: ({ code }) => {
					this.sessions.delete(id);
					this.send("pty:exit", { id, exitCode: code } satisfies PtyExitEvent);
				},
			},
		);
		if (ok === false) {
			this.sessions.delete(id);
			throw new Error("当前系统不支持内置终端（需要 Windows 10 1809 及以上）");
		}
		if (ok === null) {
			this.sessions.delete(id);
			throw new Error("运行时组件未就绪，无法创建终端");
		}
		return { id };
	}

	write(id: string, data: string): void {
		if (!this.sessions.has(id)) return;
		writeComponentPty(id, data);
	}

	resize(id: string, cols: number, rows: number): void {
		if (!this.sessions.has(id)) return;
		resizeComponentPty(id, Math.max(2, cols), Math.max(1, rows));
	}

	kill(id: string): void {
		if (!this.sessions.has(id)) return;
		this.sessions.delete(id);
		killComponentPty(id);
	}

	killAll(): void {
		for (const session of this.sessions.values()) killComponentPty(session.id);
		this.sessions.clear();
	}
}
