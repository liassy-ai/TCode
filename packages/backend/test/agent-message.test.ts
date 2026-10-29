import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { toBranchSessionMessages } from "../src/session/messages";

const entry = (id: string, agent: string, text: string, at: string): SessionEntry =>
	({
		type: "custom",
		customType: "agent-message",
		data: { agent, text },
		id,
		parentId: null,
		timestamp: at,
	}) as SessionEntry;

describe("群聊发言落盘回放（custom agent-message 条目）", () => {
	it("回放成 agent 消息：重开/刷新后仍在", () => {
		const branch = [entry("e1", "小红", "收到，现在做", "2026-01-01T00:00:00.000Z")];
		const messages = toBranchSessionMessages(branch);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({ role: "agent", agent: "小红", text: "收到，现在做" });
		expect((messages[0] as { timestamp: number }).timestamp).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
	});

	it("空文本条目被丢弃（不发空气泡）", () => {
		const branch = [entry("e1", "小红", "   ", "2026-01-01T00:00:00.000Z")];
		expect(toBranchSessionMessages(branch)).toHaveLength(0);
	});

	it("与其他条目混排：位置序即时间序", () => {
		const branch = [
			{
				type: "message",
				message: { role: "user", content: "你好", timestamp: 1 },
				id: "u1",
				parentId: null,
				timestamp: "2026-01-01T00:00:00.000Z",
			},
			entry("e1", "小红", "在做", "2026-01-01T00:00:01.000Z"),
			{
				type: "message",
				message: { role: "assistant", content: [{ type: "text", text: "好" }], timestamp: 2 },
				id: "a1",
				parentId: null,
				timestamp: "2026-01-01T00:00:02.000Z",
			},
		] as unknown as SessionEntry[];
		const messages = toBranchSessionMessages(branch);
		expect(messages.map((m) => m.role)).toEqual(["user", "agent", "assistant"]);
	});
});
