import type { SessionEvent } from "@tcode/shared";

const HIDDEN_FALLBACK_MS = 250;

export interface EventConflatorOptions {
	apply: (sessionId: string, event: SessionEvent) => void;

	schedule?: (flush: () => void) => () => void;
}

const defaultSchedule = (flush: () => void): (() => void) => {
	let done = false;
	const run = () => {
		if (done) return;
		done = true;
		cancelAnimationFrame(raf);
		clearTimeout(timer);
		flush();
	};
	const raf = requestAnimationFrame(run);
	const timer = setTimeout(run, HIDDEN_FALLBACK_MS);
	return () => {
		done = true;
		cancelAnimationFrame(raf);
		clearTimeout(timer);
	};
};

function conflatableKey(sessionId: string, event: SessionEvent): string | null {
	if (event.type === "message_update") {
		const e = (
			event as {
				assistantMessageEvent?: { type?: unknown; contentIndex?: unknown; delta?: unknown };
			}
		).assistantMessageEvent;
		if (e?.type === "text_delta" || e?.type === "thinking_delta" || e?.type === "toolcall_delta") {
			if (typeof e.delta !== "string") return null;

			if (typeof e.contentIndex !== "number") return null;
			return `${sessionId}|${e.type}|${e.contentIndex}`;
		}
		return null;
	}
	if (event.type === "agent_say") {
		if (event.done) return null;

		return `${sessionId}|agent_say|${event.id}`;
	}
	if (event.type === "tool_execution_update") {
		if (typeof event.partialResult !== "string") return null;
		return `${sessionId}|toolout|${event.toolCallId}`;
	}
	return null;
}

function mergeInto(target: SessionEvent, incoming: SessionEvent): void {
	if (target.type === "message_update" && incoming.type === "message_update") {
		const t = target as { assistantMessageEvent: { delta: string } };
		const i = incoming as { assistantMessageEvent: { delta: string } };
		t.assistantMessageEvent.delta += i.assistantMessageEvent.delta;
		return;
	}
	if (target.type === "agent_say" && incoming.type === "agent_say") {
		target.text = incoming.text;
		if (incoming.sessionFile) target.sessionFile = incoming.sessionFile;
		return;
	}
	if (target.type === "tool_execution_update" && incoming.type === "tool_execution_update") {
		target.partialResult = (target.partialResult as string) + (incoming.partialResult as string);
	}
}

interface PendingEntry {
	sessionId: string;
	event: SessionEvent;
}

export class EventConflator {
	private readonly apply: (sessionId: string, event: SessionEvent) => void;
	private readonly schedule: (flush: () => void) => () => void;
	private pending: PendingEntry[] = [];

	private keyIndex = new Map<string, number>();
	private cancelScheduled: (() => void) | null = null;

	constructor(options: EventConflatorOptions) {
		this.apply = options.apply;
		this.schedule = options.schedule ?? defaultSchedule;
	}

	push(sessionId: string, event: SessionEvent): void {
		const key = conflatableKey(sessionId, event);
		if (key === null) {
			this.flushNow();
			this.apply(sessionId, event);
			return;
		}
		const idx = this.keyIndex.get(key);
		const pending = idx !== undefined ? this.pending[idx] : undefined;
		if (pending) {
			mergeInto(pending.event, event);
		} else {
			this.keyIndex.set(key, this.pending.length);
			this.pending.push({ sessionId, event });
		}
		if (!this.cancelScheduled) this.cancelScheduled = this.schedule(() => this.flushNow());
	}

	flushNow(): void {
		if (this.cancelScheduled) {
			this.cancelScheduled();
			this.cancelScheduled = null;
		}
		if (this.pending.length === 0) return;
		const batch = this.pending;
		this.pending = [];
		this.keyIndex.clear();
		for (const { sessionId, event } of batch) {
			this.apply(sessionId, event);
		}
	}

	dispose(): void {
		this.flushNow();
	}
}
