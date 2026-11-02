import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

let agentDir = "";
vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => agentDir,
}));

import { SettingsService } from "../src/settings/settings";

const dirs: string[] = [];

async function makeSettings() {
	agentDir = await mkdtemp(join(tmpdir(), "tcode-provider-levels-"));
	dirs.push(agentDir);
	const runtime = {
		refresh: vi.fn().mockResolvedValue({ aborted: false }),
		getProviders: () => [{ id: "acme", name: "Acme", auth: {} }],
		getRegisteredNativeProvider: () => undefined,
		getProviderAuthStatus: () => ({ configured: false }),
		getModels: () => [],
	} as unknown as ModelRuntime;
	return new SettingsService(async () => runtime);
}

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("自定义 provider 的档位映射", () => {
	it("关闭档固定写 off = disabled；其余档填了才落键，没开思考的模型整个键不出现", async () => {
		const settings = await makeSettings();
		await settings.addCustomProvider({
			id: "acme",
			baseUrl: "https://api.example.com/v1",
			api: "openai-completions",
			models: [
				{
					id: "acme-large",
					reasoning: true,
					contextWindow: 128000,
					maxTokens: 16384,
					thinkingLevelMap: {
						medium: "low",
						high: "high",
						xhigh: "xhigh",
						max: "max",
					},
				},
				{
					id: "only-xhigh",
					reasoning: true,
					contextWindow: 128000,
					maxTokens: 16384,
					thinkingLevelMap: { xhigh: "extra-high" },
				},
				{ id: "thinking-no-custom", reasoning: true, contextWindow: 128000, maxTokens: 16384 },
				{ id: "no-thinking", contextWindow: 128000, maxTokens: 16384 },
			],
		});

		const written = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as {
			providers: Record<string, { models: Array<Record<string, unknown>> }>;
		};
		const models = written.providers.acme?.models ?? [];

		const first = models[0]?.thinkingLevelMap as Record<string, string> | undefined;
		expect(first).toEqual({ off: "disabled", medium: "low", high: "high", xhigh: "xhigh", max: "max" });
		expect(first).not.toHaveProperty("none");
		expect(first).not.toHaveProperty("disabled");

		expect(models[1]?.thinkingLevelMap).toEqual({ off: "disabled", xhigh: "extra-high" });

		expect(models[2]?.thinkingLevelMap).toEqual({ off: "disabled" });

		expect(models[3]).not.toHaveProperty("thinkingLevelMap");
	});

	it("编辑表单回读只给可自定义的四档（关闭档固定值不进表单），落盘原文仍带 off", async () => {
		const settings = await makeSettings();
		await settings.addCustomProvider({
			id: "acme",
			baseUrl: "https://api.example.com/v1",
			api: "openai-completions",
			models: [
				{
					id: "acme-large",
					reasoning: true,
					contextWindow: 128000,
					maxTokens: 16384,
					thinkingLevelMap: { medium: "low", high: "high" },
				},
			],
		});

		const acme = (await settings.listProviders()).find((provider) => provider.id === "acme");
		expect(acme?.customModels?.[0]?.thinkingLevelMap).toEqual({ medium: "low", high: "high" });

		const written = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as {
			providers: Record<string, { models: Array<Record<string, unknown>> }>;
		};
		expect(written.providers.acme?.models?.[0]?.thinkingLevelMap).toEqual({
			off: "disabled",
			medium: "low",
			high: "high",
		});
	});

	it("空格位写 null（该档不支持），回读保留 null", async () => {
		const settings = await makeSettings();
		await settings.addCustomProvider({
			id: "acme",
			baseUrl: "https://api.example.com/v1",
			api: "openai-completions",
			models: [
				{
					id: "acme-large",
					reasoning: true,
					contextWindow: 128000,
					maxTokens: 16384,
					thinkingLevelMap: { low: null, medium: "low", xhigh: null },
				},
			],
		});

		const written = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as {
			providers: Record<string, { models: Array<Record<string, unknown>> }>;
		};
		expect(written.providers.acme?.models?.[0]?.thinkingLevelMap).toEqual({
			off: "disabled",
			low: null,
			medium: "low",
			xhigh: null,
		});

		const acme = (await settings.listProviders()).find((provider) => provider.id === "acme");
		expect(acme?.customModels?.[0]?.thinkingLevelMap).toEqual({ low: null, medium: "low", xhigh: null });
	});
});
