import { describe, expect, it } from "vitest";
import type { SingleResult } from "../src/tools/subagent/runner";
import { finalizeSubagentResult, subagentParams } from "../src/tools/subagent/tool";

function makeResult(overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		agent: "Explore",
		task: "t",
		exitCode: 0,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: { tokens: 0 } },
		artifactPaths: {},
		...overrides,
	};
}

describe("subagentParams schema（provider 兼容，0.4.5 回归）", () => {
	const schema = JSON.parse(JSON.stringify(subagentParams)) as Record<string, unknown>;

	it("顶层必须是 type:object（DeepSeek 等 openai-completions 端点硬性要求）", () => {
		expect(schema.type).toBe("object");
	});

	it("顶层不使用 anyOf/allOf 组合器（anthropic convertTools 会剥掉它们，剩空 schema）", () => {
		expect(schema.anyOf).toBeUndefined();
		expect(schema.allOf).toBeUndefined();
	});

	it("完整 properties：agent/task/cwd/tasks/confirmProjectAgents 均带描述", () => {
		const props = schema.properties as Record<string, { description?: string }>;
		expect(Object.keys(props)).toEqual(
			expect.arrayContaining(["agent", "task", "cwd", "runId", "tasks", "confirmProjectAgents"]),
		);
		for (const key of ["agent", "task", "runId", "tasks"]) {
			expect(props[key]?.description, `${key} 缺 description`).toBeTruthy();
		}
	});

	it("所有字段 optional（互斥约束由 execute 运行时校验兜底）", () => {
		expect(schema.required).toBeUndefined();
	});
});

describe("finalizeSubagentResult（失败语义 spec §6）", () => {
	it("single 成功：content 为结论，无 isError", () => {
		const result = finalizeSubagentResult("single", [makeResult({ content: "done" })]);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]).toEqual({ type: "text", text: "done" });
	});

	it("single 失败：isError + content 带诊断（不给模型空字符串）", () => {
		const result = finalizeSubagentResult("single", [
			makeResult({ exitCode: 1, error: "model exploded", content: undefined }),
		]);
		expect(result.isError).toBe(true);
		expect(result.content[0]).toEqual({
			type: "text",
			text: "Subagent Explore failed: model exploded",
		});
	});

	it("single 无错误消息的失败（abort）：回落 aborted 诊断", () => {
		const result = finalizeSubagentResult("single", [makeResult({ exitCode: 1 })]);
		expect(result.isError).toBe(true);
		expect(result.content[0]).toEqual({ type: "text", text: "Subagent Explore failed: aborted" });
	});

	it("parallel 部分失败：不置 isError，Error 行在 content 里", () => {
		const result = finalizeSubagentResult("parallel", [
			makeResult({ content: "ok" }),
			makeResult({ agent: "Explore2", exitCode: 1, error: "boom" }),
		]);
		expect(result.isError).toBeUndefined();
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("## 1. Explore\nok");
		expect(text).toContain("## 2. Explore2\nError: boom");
	});

	it("parallel 全败：isError", () => {
		const result = finalizeSubagentResult("parallel", [
			makeResult({ exitCode: 1, error: "a" }),
			makeResult({ exitCode: 1, error: "b" }),
		]);
		expect(result.isError).toBe(true);
	});

	it("single 带 runId：content 附续聊提示", () => {
		const result = finalizeSubagentResult("single", [makeResult({ content: "done", runId: "r-1" })]);
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("done");
		expect(text).toContain("[runId: r-1]");
		expect(text).toContain('runId: "r-1"');
	});

	it("single 失败也附 runId（便于带着上文重试）", () => {
		const result = finalizeSubagentResult("single", [
			makeResult({ exitCode: 1, error: "boom", runId: "r-2" }),
		]);
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("failed: boom");
		expect(text).toContain("[runId: r-2]");
	});

	it("parallel 带 runId：每块各附自己的 runId", () => {
		const result = finalizeSubagentResult("parallel", [
			makeResult({ content: "ok", runId: "r-a" }),
			makeResult({ agent: "Explore2", content: "ok2", runId: "r-b" }),
		]);
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("## 1. Explore\nok\n[runId: r-a]");
		expect(text).toContain("## 2. Explore2\nok2\n[runId: r-b]");
	});

	it("无 runId：content 不带续聊提示（普通运行零影响）", () => {
		const result = finalizeSubagentResult("single", [makeResult({ content: "done" })]);
		expect((result.content[0] as { text: string }).text).toBe("done");
	});
});
