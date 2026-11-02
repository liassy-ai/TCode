import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
	const runSubagent = vi.fn();
	const discoverAgents = vi.fn();
	const findAgent = vi.fn();
	return {
		runSubagent,
		discoverAgents,
		findAgent,
		agentRoster: vi.fn(() => "Test agents — Explore"),
		discoverAgentRosterSync: vi.fn(() => []),
	};
});

vi.mock("../src/tools/subagent/agents", () => ({
	discoverAgents: h.discoverAgents,
	findAgent: h.findAgent,
	agentRoster: h.agentRoster,
	discoverAgentRosterSync: h.discoverAgentRosterSync,
}));
vi.mock("../src/tools/subagent/runner", () => ({ runSubagent: h.runSubagent }));

import { makeSubagentTool } from "../src/tools/subagent/tool";

const SUB_FILE = "C:/Users/x/.pi/agent-dev/sessions-subagents/proj/sess-1.jsonl";

function makeTool() {
	return makeSubagentTool({
		getModelRuntime: async () => ({}) as never,
		getSubagentModel: async () => undefined,
		getSubagentThinkingLevel: async () => undefined,
		gate: {} as never,
		traces: {} as never,
	});
}

const ctx = {
	cwd: "/proj",
	model: { provider: "p", id: "m" },
	isProjectTrusted: () => true,
	hasUI: false,
	ui: { confirm: async () => true },
};

async function run(tool: ReturnType<typeof makeTool>, params: Record<string, unknown>) {
	return (
		tool as {
			execute: (...a: unknown[]) => Promise<{
				content: Array<{ text: string }>;
				details: { results: Array<{ runId?: string; task: string }> };
			}>;
		}
	).execute("call-1", params, undefined, undefined, ctx);
}

beforeEach(() => {
	h.runSubagent.mockReset();
	h.discoverAgents.mockReset();
	h.findAgent.mockReset();
	h.discoverAgents.mockResolvedValue([{ name: "Explore", source: "global" }]);
	h.findAgent.mockImplementation((agents: Array<{ name: string }>, name: string) => {
		const found = agents.find((a) => a.name === name);
		if (!found) throw new Error(`Unknown agent "${name}"`);
		return found;
	});
	h.runSubagent.mockImplementation(
		async (_deps: unknown, input: { agent: { name: string }; task: string }) => ({
			agent: input.agent.name,
			task: input.task,
			sessionId: "sess-1",
			model: "m",
			exitCode: 0,
			content: `done: ${input.task}`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: { tokens: 0 } },
			artifactPaths: { jsonlPath: SUB_FILE },
		}),
	);
});

describe("subagent 续聊（阶段 0）", () => {
	it("新运行：注册 runId 并在 content 附续聊提示", async () => {
		const tool = makeTool();
		const res = await run(tool, { agent: "Explore", task: "t1" });
		expect(res.details.results[0]?.runId).toBe("sess-1");
		expect(res.content[0]?.text).toContain("[runId: sess-1]");
	});

	it("续聊：凭 runId 用同一子会话文件重跑（resumeSessionFile）", async () => {
		const tool = makeTool();
		await run(tool, { agent: "Explore", task: "t1" });
		h.runSubagent.mockClear();
		const res = await run(tool, { runId: "sess-1", task: "t2" });
		const input = h.runSubagent.mock.calls[0]?.[1] as { resumeSessionFile?: string; task: string };
		expect(input.resumeSessionFile).toBe(SUB_FILE);
		expect(input.task).toBe("t2");
		expect(res.content[0]?.text).toContain("done: t2");
	});

	it("未知 runId：报错（提示只能续本会话发起过的运行）", async () => {
		const tool = makeTool();
		await expect(run(tool, { runId: "nope", task: "t" })).rejects.toThrow(/Unknown runId/);
	});

	it("runId 与 tasks 互斥：报错", async () => {
		const tool = makeTool();
		await expect(
			run(tool, { runId: "sess-1", task: "t", tasks: [{ agent: "Explore", task: "x" }] }),
		).rejects.toThrow(/not both/);
	});

	it("续聊缺 task：报错", async () => {
		const tool = makeTool();
		await expect(run(tool, { runId: "sess-1" })).rejects.toThrow(/needs the follow-up task/);
	});
});
