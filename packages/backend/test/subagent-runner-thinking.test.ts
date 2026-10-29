import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionGate } from "../src/permissions/gate";
import type { SessionTraces } from "../src/session/traces";
import type { SubagentDefinition } from "../src/tools/subagent/agents";

const { createAgentSessionMock } = vi.hoisted(() => ({ createAgentSessionMock: vi.fn() }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return {
		...actual,

		createAgentSession: (...args: unknown[]) => createAgentSessionMock(...args),
	};
});

import { resolveSubagentThinkingLevel, runSubagent } from "../src/tools/subagent/runner";

const tempDirs: string[] = [];

beforeEach(() => {
	createAgentSessionMock.mockReset();
});

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	delete process.env.PI_CODING_AGENT_DIR;
});

function agent(overrides: Partial<SubagentDefinition> = {}): SubagentDefinition {
	return {
		name: "Explore",
		description: "test agent",
		tools: ["read"],
		systemPrompt: "You are a test agent.",
		source: "user",
		...overrides,
	};
}

async function makeDirs() {
	const root = await mkdtemp(join(tmpdir(), "tcode-subagent-thinking-"));
	tempDirs.push(root);
	return { root, agentDir: join(root, "agent"), cwd: join(root, "project") };
}

function stubSession() {
	const listeners = new Set<(event: unknown) => void>();
	return {
		sessionId: "child-session",
		sessionFile: undefined,
		model: { provider: "mock", id: "model" },

		thinkingLevel: "high",
		messages: [],
		sessionManager: { getSessionDir: () => "/tmp/child" },
		subscribe: (fn: (event: unknown) => void) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		setSessionName: () => undefined,
		bindExtensions: async () => undefined,
		prompt: async () => {
			for (const fn of listeners) fn({ type: "agent_settled" });
		},
		dispose: () => undefined,
		abort: async () => undefined,
	};
}

async function run(options: { definition: SubagentDefinition; preferred?: string; effective?: string }) {
	const { agentDir, cwd } = await makeDirs();
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const session = stubSession();
	if (options.effective) session.thinkingLevel = options.effective;
	createAgentSessionMock.mockResolvedValue({ session, extensionsResult: { extensions: [] } });
	const result = await runSubagent(
		{
			getModelRuntime: async () => ({}) as ModelRuntime,
			getSubagentModel: async () => undefined,
			getSubagentThinkingLevel: async () => options.preferred,
			gate: { confirm: async () => false } as unknown as PermissionGate,
			traces: {
				start: async () => undefined,
				stop: async () => undefined,
				record: () => undefined,
			} as unknown as SessionTraces,
		},
		{ agent: options.definition, task: "do the thing", cwd, projectTrusted: false },
	);
	return { result, session };
}

describe("runner thinkingLevel 传递（spec R1）", () => {
	it("frontmatter 档位作为显式 options.thinkingLevel 传给 createAgentSession", async () => {
		const { result } = await run({ definition: agent({ thinking: "high" }) });
		expect(createAgentSessionMock).toHaveBeenCalledOnce();
		expect(createAgentSessionMock.mock.calls[0]?.[0]).toMatchObject({ thinkingLevel: "high" });

		expect(result.thinkingLevel).toBe("high");
	});

	it("设置页覆盖优先于 frontmatter", async () => {
		await run({ definition: agent({ thinking: "high" }), preferred: "medium" });
		expect(createAgentSessionMock.mock.calls[0]?.[0]).toMatchObject({ thinkingLevel: "medium" });
	});

	it("两者皆无时不传档位（undefined = 走 SDK 默认链）", async () => {
		await run({ definition: agent({ thinking: undefined }) });
		expect(createAgentSessionMock.mock.calls[0]?.[0]).toMatchObject({ thinkingLevel: undefined });
	});

	it("设置页脏值跳过、回退 frontmatter", async () => {
		await run({ definition: agent({ thinking: "medium" }), preferred: "ultra" });
		expect(createAgentSessionMock.mock.calls[0]?.[0]).toMatchObject({ thinkingLevel: "medium" });
	});
});

describe("resolveSubagentThinkingLevel", () => {
	it("设置页 > frontmatter > undefined；脏值忽略、合法档位优先", () => {
		expect(resolveSubagentThinkingLevel("medium", "high")).toBe("medium");
		expect(resolveSubagentThinkingLevel(undefined, "high")).toBe("high");
		expect(resolveSubagentThinkingLevel(undefined, undefined)).toBeUndefined();
		expect(resolveSubagentThinkingLevel("ultra", "high")).toBe("high");
		expect(resolveSubagentThinkingLevel("", "high")).toBe("high");

		expect(resolveSubagentThinkingLevel("low", "high")).toBe("low");
		expect(resolveSubagentThinkingLevel("minimal", "high")).toBe("minimal");
	});
});
