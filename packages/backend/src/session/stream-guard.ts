import type { SessionEvent } from "@tcode/shared";

export type StreamGuardVerdict = "pass" | "suppress" | "trip_whitespace" | "trip_oversize";

export interface StreamGuardLimits {
	wsRunBytes: number;

	totalBytes: number;
}

export const DEFAULT_STREAM_GUARD_LIMITS: StreamGuardLimits = {
	wsRunBytes: 8 * 1024,

	totalBytes: 2 * 1024 * 1024,
};

interface GuardState {
	wsRun: number;
	total: number;
	tripped: boolean;
}

export class StreamGuard {
	private readonly states = new Map<string, GuardState>();

	constructor(private readonly limits: StreamGuardLimits = DEFAULT_STREAM_GUARD_LIMITS) {}

	inspect(sessionId: string, event: SessionEvent): StreamGuardVerdict {
		if (event.type === "agent_end" || event.type === "agent_settled") {
			this.states.delete(sessionId);
			return "pass";
		}
		const st = this.stateOf(sessionId);
		if (event.type === "message_start" || event.type === "message_end") {
			st.wsRun = 0;
			st.total = 0;
			st.tripped = false;
			return "pass";
		}
		if (event.type !== "message_update") return "pass";
		if (st.tripped) return "suppress";

		const e = (event as { assistantMessageEvent?: { type?: unknown; delta?: unknown } })
			.assistantMessageEvent;
		if (e?.type !== "text_delta" && e?.type !== "thinking_delta" && e?.type !== "toolcall_delta") {
			return "pass";
		}
		const delta = typeof e.delta === "string" ? e.delta : "";
		st.total += delta.length;
		st.wsRun = delta.trim() === "" ? st.wsRun + delta.length : 0;
		if (st.wsRun > this.limits.wsRunBytes) {
			st.tripped = true;
			return "trip_whitespace";
		}
		if (st.total > this.limits.totalBytes) {
			st.tripped = true;
			return "trip_oversize";
		}
		return "pass";
	}

	cleanup(sessionId: string): void {
		this.states.delete(sessionId);
	}

	private stateOf(sessionId: string): GuardState {
		let st = this.states.get(sessionId);
		if (!st) {
			st = { wsRun: 0, total: 0, tripped: false };
			this.states.set(sessionId, st);
		}
		return st;
	}
}
