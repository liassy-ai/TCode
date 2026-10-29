import type { ContextManagerMode, ModelPrefs, SubagentInfo } from "@tcode/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const piMock = vi.hoisted(() => ({
	getPermissionConfig: vi.fn(() => Promise.resolve({ enabled: true })),
	getChannelWatchConfig: vi.fn(() => Promise.resolve({ enabled: true })),
	webAccessGetStatus: vi.fn(() =>
		Promise.resolve({ enabled: false, listening: false, port: 1200, url: null, token: "test-token" }),
	),
	webAccessRegenerateToken: vi.fn(() =>
		Promise.resolve({
			enabled: true,
			listening: true,
			port: 1200,
			scope: "lan" as const,
			url: "http://127.0.0.1:1200",
			token: "test-token",
		}),
	),
	listProviders: vi.fn(() => Promise.resolve({ providers: [] })),
	listSubagents: vi.fn<() => Promise<SubagentInfo[]>>(() => Promise.resolve([])),
	getModelPrefs: vi.fn<() => Promise<ModelPrefs>>(() =>
		Promise.resolve({ hiddenModels: {}, subagentModels: {} }),
	),
	getSkillPrefs: vi.fn(() => Promise.resolve({ disabled: [] })),
	listSkills: vi.fn(() => Promise.resolve([])),
	listExtensions: vi.fn(() => Promise.resolve([])),
	getContextManagerConfig: vi.fn(() => Promise.resolve({ mode: "evaporation" })),
	setContextManagerMode: vi.fn(() => Promise.resolve()),
}));
vi.mock("../api", () => ({ getPi: () => piMock }));

import { bootstrapSettings, useSettingsStore } from "./settings";

function resetStore() {
	useSettingsStore.setState({
		contextManagerMode: null,
		webAccessStatus: null,
		webAccessSaving: false,
		error: null,
		loading: false,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	resetStore();
});

describe("bootstrapSettings：开屏引导设置域全局快照（防「要开设置才加载」复发）", () => {
	it("一次把 modelPrefs/subagents 拉进 store，且幂等（重复调用只跑一次）", async () => {
		piMock.getModelPrefs.mockResolvedValue({ hiddenModels: {}, subagentModels: {}, mainAgentName: "小李" });
		piMock.listSubagents.mockResolvedValue([
			{ name: "Explore", description: "", source: "builtin", tools: [], systemPrompt: "" },
		]);
		bootstrapSettings();
		bootstrapSettings();
		await vi.waitFor(() => expect(useSettingsStore.getState().modelPrefs?.mainAgentName).toBe("小李"));
		expect(useSettingsStore.getState().subagents).toHaveLength(1);
		expect(piMock.getModelPrefs).toHaveBeenCalledTimes(1);
	});
});

describe("settings store：contextManagerMode（乐观更新 + 失败回滚）", () => {
	it("独立加载：getContextManagerConfig 结果进 store", async () => {
		piMock.getContextManagerConfig.mockResolvedValue({ mode: "evaporation" as ContextManagerMode });
		await useSettingsStore.getState().refresh();
		expect(useSettingsStore.getState().contextManagerMode).toBe("evaporation");
	});

	it("加载失败不置值（保持 null，静默）", async () => {
		piMock.getContextManagerConfig.mockRejectedValue(new Error("boom"));
		await useSettingsStore.getState().refresh();
		expect(useSettingsStore.getState().contextManagerMode).toBeNull();
	});

	it("切换成功：乐观更新生效", async () => {
		useSettingsStore.setState({ contextManagerMode: "off" });
		await useSettingsStore.getState().setContextManagerMode("evaporation");
		expect(piMock.setContextManagerMode).toHaveBeenCalledWith({ mode: "evaporation" });
		expect(useSettingsStore.getState().contextManagerMode).toBe("evaporation");
		expect(useSettingsStore.getState().error).toBeNull();
	});

	it("切换失败：回滚上一模式并记录错误", async () => {
		useSettingsStore.setState({ contextManagerMode: "evaporation" });
		piMock.setContextManagerMode.mockRejectedValue(new Error("disk full"));
		await useSettingsStore.getState().setContextManagerMode("off");
		expect(useSettingsStore.getState().contextManagerMode).toBe("evaporation");
		expect(useSettingsStore.getState().error).toBe("disk full");
	});
});

describe("settings store：web 桥口令重新生成", () => {
	const nextStatus = {
		enabled: true,
		listening: true,
		port: 1200,
		scope: "lan" as const,
		url: "http://10.0.0.2:1200",
		token: "rotated-token-0123456789abcdef",
	};

	it("成功：status 换成回包里的新状态并复位 saving", async () => {
		piMock.webAccessRegenerateToken.mockResolvedValue(nextStatus);
		await useSettingsStore.getState().regenerateWebAccessToken();
		expect(useSettingsStore.getState().webAccessStatus).toEqual(nextStatus);
		expect(useSettingsStore.getState().webAccessSaving).toBe(false);
		expect(useSettingsStore.getState().error).toBeNull();
	});

	it("失败：记录错误并复位 saving", async () => {
		piMock.webAccessRegenerateToken.mockRejectedValue(new Error("bridge down"));
		await useSettingsStore.getState().regenerateWebAccessToken();
		expect(useSettingsStore.getState().webAccessSaving).toBe(false);
		expect(useSettingsStore.getState().error).toBe("bridge down");
	});
});
