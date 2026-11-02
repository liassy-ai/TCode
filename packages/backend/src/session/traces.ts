import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../log";
import { TraceRecorder } from "./trace";

const log = createLogger("backend");

export class SessionTraces {
	private readonly recorders = new Map<string, TraceRecorder>();

	async start(sessionId: string, sessionDir: string | undefined): Promise<void> {
		if (!sessionDir) return;
		try {
			const recorder = await TraceRecorder.create(sessionDir, sessionId);
			this.recorders.set(sessionId, recorder);
		} catch (err) {
			log.warn("trace create failed", sessionId, err);
		}
	}

	record(sessionId: string, event: AgentSessionEvent): void {
		this.recorders.get(sessionId)?.record(event);
	}

	recordCustom(sessionId: string, kind: string, data: unknown): void {
		this.recorders.get(sessionId)?.record({ type: "trace_custom", kind, data, ts: Date.now() });
	}

	async stop(sessionId: string): Promise<void> {
		const recorder = this.recorders.get(sessionId);
		if (!recorder) return;
		this.recorders.delete(sessionId);
		await recorder.close();
	}

	disposeAll(): void {
		for (const recorder of this.recorders.values()) {
			void recorder.close();
		}
		this.recorders.clear();
	}
}
