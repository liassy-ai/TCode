import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { PermissionGate } from "../src/permissions/gate";
import type { SessionTraces } from "../src/session/traces";
import { makeSubagentTool } from "../src/tools/subagent";
import { applySubagentMutex, resolveSubagentPreferBuiltin } from "../src/tools/subagent/mutex";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function thirdPartySubagentExtension() {
	return {
		name: "fake-pi-subagents",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: "subagent",
				label: "ThirdPartySubagent",
				description: "third-party fake subagent tool",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text" as const, text: "fake" }] }),
			});
			pi.registerTool({
				name: "subagent_wait",
				label: "ThirdPartyWait",
				description: "third-party fake wait tool",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text" as const, text: "fake" }] }),
			});
		},
	};
}

describe("subagent tool shadowing（真实 SDK 语义）", () => {
	it("内置 customTool 覆盖同名扩展工具，mutex 停用家族工具", async () => {
		const root = await mkdtemp(join(tmpdir(), "tcode-subagent-shadow-"));
		tempDirs.push(root);
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			extensionFactories: [thirdPartySubagentExtension()],
		});

		await resourceLoader.reload();
		const builtinTool = makeSubagentTool({
			getModelRuntime: () => Promise.reject(new Error("not needed in test")),
			gate: { confirm: () => Promise.resolve(false) } as unknown as PermissionGate,
			traces: {
				record: () => undefined,
				start: () => Promise.resolve(),
				stop: () => Promise.resolve(),
			} as unknown as SessionTraces,
		});
		const { session, extensionsResult } = await createAgentSession({
			cwd,
			agentDir,
			customTools: [builtinTool],
			sessionManager: SessionManager.create(cwd, join(root, "sessions")),
			settingsManager: SettingsManager.create(cwd, agentDir),
			resourceLoader,
		});
		try {
			const subagentInfo = session.getAllTools().find((tool) => tool.name === "subagent");
			expect(subagentInfo?.description).toBe(builtinTool.description);
			expect(session.getActiveToolNames()).toContain("subagent");

			const mutex = applySubagentMutex(session, extensionsResult, true);
			expect(mutex.shadowed).toHaveLength(1);
			expect(mutex.disabledToolNames).toEqual(["subagent_wait"]);
			expect(session.getActiveToolNames()).not.toContain("subagent_wait");
			expect(session.getActiveToolNames()).toContain("subagent");
			expect(session.getAllTools().find((tool) => tool.name === "subagent")?.description).toBe(
				builtinTool.description,
			);
		} finally {
			session.dispose();
		}
	});

	describe("preferBuiltin 开关（#47）", () => {
		it("preferBuiltin=false 时不遮蔽扩展工具，subagent_* 家族保持可用", async () => {
			const root = await mkdtemp(join(tmpdir(), "tcode-subagent-shadow-"));
			tempDirs.push(root);
			const agentDir = join(root, "agent");
			const cwd = join(root, "project");
			const resourceLoader = new DefaultResourceLoader({
				cwd,
				agentDir,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				extensionFactories: [thirdPartySubagentExtension()],
			});
			await resourceLoader.reload();
			const { session, extensionsResult } = await createAgentSession({
				cwd,
				agentDir,
				sessionManager: SessionManager.create(cwd, join(root, "sessions")),
				settingsManager: SettingsManager.create(cwd, agentDir),
				resourceLoader,
			});
			try {
				const mutex = applySubagentMutex(session, extensionsResult, false);
				expect(mutex).toEqual({ shadowed: [], disabledToolNames: [] });
				expect(session.getActiveToolNames()).toContain("subagent");
				expect(session.getActiveToolNames()).toContain("subagent_wait");
			} finally {
				session.dispose();
			}
		});

		it("构造参数（嵌入宿主 override）优先于持久偏好，缺省为 true", () => {
			expect(resolveSubagentPreferBuiltin(false, true)).toBe(false);
			expect(resolveSubagentPreferBuiltin(true, false)).toBe(true);
			expect(resolveSubagentPreferBuiltin(undefined, false)).toBe(false);
			expect(resolveSubagentPreferBuiltin(undefined, undefined)).toBe(true);
		});
	});
});
