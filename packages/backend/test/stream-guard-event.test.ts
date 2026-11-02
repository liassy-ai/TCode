import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PiBackend } from "../src/pi-backend";
import type { SessionRegistry } from "../src/session/registry";

function makeBackend(sessionId: string): PiBackend {
	const backend = new PiBackend({ defaultCwd: "/tmp", projectTrust: false, permissionGates: false });
	const registry = (backend as unknown as { registry: SessionRegistry }).registry;
	registry.add({
		session: { sessionId, dispose: () => {}, abort: async () => {} } as unknown as AgentSession,
		unsubscribe: () => {},
		cwd: "/tmp",
	});
	return backend;
}

const blankDelta = (bytes: number) => ({
	type: "message_update" as const,
	assistantMessageEvent: { type: "text_delta" as const, delta: "\n".repeat(bytes), contentIndex: 0 },
});

describe("PiBackend.emitEvent — StreamGuard 熔断合成事件", () => {
	it("trip 时 handler 收到 stream_guard_tripped（含 verdict），非 trip 事件不吞", async () => {
		const backend = makeBackend("s1");
		const received: Array<{ type: string; verdict?: string }> = [];
		backend.onEvent((_sid, event) => {
			received.push(event as { type: string; verdict?: string });
		});
		const emit = (sid: string, event: unknown) =>
			(backend as unknown as { emitEvent: (sid: string, event: unknown) => void }).emitEvent(sid, event);

		emit("s1", {
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "hello", contentIndex: 0 },
		});
		expect(received.some((r) => r.type === "stream_guard_tripped")).toBe(false);

		emit("s1", blankDelta(9 * 1024));
		const trip = received.find((r) => r.type === "stream_guard_tripped");
		expect(trip).toBeDefined();
		if (trip) expect(trip.verdict).toMatch(/trip_whitespace/);

		const countBefore = received.length;
		emit("s1", blankDelta(1024));
		expect(received.length).toBe(countBefore);
	});

	it("合成事件不进 trace（traces.record 只收 pi 事件）", () => {
		const backend = makeBackend("s1") as unknown as {
			traces: { record: (sid: string, ev: { type: string }) => void };
			emitEvent: (sid: string, event: unknown) => void;
		};
		const recorded: string[] = [];
		backend.traces.record = (_sid, ev) => {
			recorded.push(ev.type);
		};

		backend.emitEvent("s1", blankDelta(9 * 1024));
		expect(recorded).not.toContain("stream_guard_tripped");
		expect(recorded).not.toContain("message_update");
	});
});
