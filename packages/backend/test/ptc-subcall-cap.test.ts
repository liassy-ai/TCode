import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PtcBridge } from "../src/tools/ptc/bridge";

const control = { pauseClock: () => {}, resumeClock: () => {} };

function makeBridge() {
	const executed: unknown[] = [];
	const events: string[] = [];
	const tool = {
		name: "read",
		execute: async (_id: string, args: unknown) => {
			executed.push(args);
			return { content: [{ type: "text", text: "ok" }] };
		},
	} as unknown as ToolDefinition;
	const bridge = new PtcBridge({
		resolveTool: (_sessionId, name) => (name === "read" ? tool : undefined),
		cwd: process.cwd(),
		parentToolCallId: "call-1",
		ctx: {} as unknown as ExtensionContext,
		onSubCall: (event) => events.push(`${event.phase}:${event.tool}`),
	});
	return { bridge, executed, events };
}

describe("run_code 单次程序的子调用次数上限", () => {
	it("前 10 次正常执行，第 11 次抛可捕获错误且没落到工具里", async () => {
		const { bridge, executed, events } = makeBridge();
		for (let i = 0; i < 10; i++) await bridge.dispatch("read", { path: `f${i}.txt` }, control);
		expect(executed).toHaveLength(10);
		expect(bridge.summaries).toHaveLength(10);

		await expect(bridge.dispatch("read", { path: "f10.txt" }, control)).rejects.toThrow(
			/最多调用 10 次工具.*第 11 次「read」被拒/,
		);

		expect(executed).toHaveLength(10);
		expect(bridge.summaries).toHaveLength(10);
		expect(events).toHaveLength(20);

		await expect(bridge.dispatch("read", {}, control)).rejects.toThrow(/最多调用 10 次工具/);
	});

	it("工具名不存在不吃名额（上限只算真正跑过的调用）", async () => {
		const { bridge, executed } = makeBridge();
		await expect(bridge.dispatch("nope", {}, control)).rejects.toThrow(/不可用/);
		for (let i = 0; i < 10; i++) await bridge.dispatch("read", {}, control);
		expect(executed).toHaveLength(10);
		await expect(bridge.dispatch("read", {}, control)).rejects.toThrow(/最多调用 10 次工具/);
	});

	it("并发提交（同一个程序里 Promise.all）也只放行 10 个", async () => {
		const { bridge, executed } = makeBridge();
		const results = await Promise.allSettled(
			Array.from({ length: 14 }, (_, i) => bridge.dispatch("read", { i }, control)),
		);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
		expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
		expect(executed).toHaveLength(10);
	});

	it("结算（dispose）后再调用：先报已结束，不再走上限判定", async () => {
		const { bridge } = makeBridge();
		bridge.dispose();
		await expect(bridge.dispatch("read", {}, control)).rejects.toThrow(/已结束/);
	});
});
