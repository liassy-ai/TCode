import { beforeEach, describe, expect, it, vi } from "vitest";

const openBrowserTab = vi.hoisted(() => vi.fn());
vi.mock("../sidepane/openers", () => ({ openBrowserTab }));

const sidePaneState = vi.hoisted(() => ({
	owners: [] as Array<{
		sessionId: string;
		tabs: Array<{ id: string; kind: string; payload: Record<string, string> }>;
	}>,
	reloadTab: vi.fn(),
}));
vi.mock("../sidepane/store", () => ({ useSidePaneStore: { getState: () => sidePaneState } }));

import {
	extractLocalServerUrl,
	handleAgentSettled,
	isLocalPreviewUrl,
	noteToolActivity,
	noteToolOutput,
	toolResultText,
} from "./site-preview";

describe("extractLocalServerUrl", () => {
	it("vite 输出（含 ANSI 色码）取 http://localhost:5173", () => {
		const out =
			"\u001b[32m  VITE v5.0.0  ready in 300 ms\u001b[0m\n\n  \u001b[32m➜\u001b[0m  Local:   \u001b[36mhttp://localhost:5173/\u001b[0m\n  \u001b[32m➜\u001b[0m  Network: use --host to expose";
		expect(extractLocalServerUrl(out)).toBe("http://localhost:5173");
	});

	it("next / python / uvicorn 的启动行都认", () => {
		expect(extractLocalServerUrl("  - Local:        http://localhost:3000")).toBe("http://localhost:3000");
		expect(extractLocalServerUrl("Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...")).toBe(
			"http://0.0.0.0:8000",
		);
		expect(
			extractLocalServerUrl("INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)"),
		).toBe("http://127.0.0.1:8000");
	});

	it("多个候选取最后一个（后启动的服务优先）", () => {
		const out = "API: http://localhost:3001\nWEB: http://localhost:5174";
		expect(extractLocalServerUrl(out)).toBe("http://localhost:5174");
	});

	it("失败行跳过：端口冲突的中间输出不触发，成功行仍认", () => {
		const out =
			"Error: listen EADDRINUSE: address already in use http://localhost:3000\nServer running at http://localhost:3001";
		expect(extractLocalServerUrl(out)).toBe("http://localhost:3001");
	});

	it("外网 URL 与无端口的 localhost 都不认", () => {
		expect(extractLocalServerUrl("Open https://example.com:443 or http://localhost for docs")).toBeNull();
	});

	it("尾标点与斜杠清洗", () => {
		expect(extractLocalServerUrl("Visit http://localhost:3000.")).toBe("http://localhost:3000");
		expect(extractLocalServerUrl("(see http://127.0.0.1:8080/)")).toBe("http://127.0.0.1:8080");
	});

	it("空输出 → null", () => {
		expect(extractLocalServerUrl("")).toBeNull();
	});
});

describe("handleAgentSettled", () => {
	beforeEach(() => {
		openBrowserTab.mockClear();
		sidePaneState.owners = [];
	});

	it("登记候选后 settle 自动打开（URL 已归一化）", () => {
		noteToolOutput("s1", "ready in 300 ms\n  Local: http://localhost:5173/");
		handleAgentSettled("s1");
		expect(openBrowserTab).toHaveBeenCalledTimes(1);
		expect(openBrowserTab).toHaveBeenCalledWith("http://localhost:5173");
	});

	it("同一 URL 第二次 settle 不再自动开（关掉不重开）", () => {
		noteToolOutput("s2", "http://localhost:5173/");
		handleAgentSettled("s2");
		noteToolOutput("s2", "http://localhost:5173/");
		handleAgentSettled("s2");
		expect(openBrowserTab).toHaveBeenCalledTimes(1);
	});

	it("换了新端口的 URL → 再开", () => {
		noteToolOutput("s3", "http://localhost:5173/");
		handleAgentSettled("s3");
		noteToolOutput("s3", "http://localhost:5199/");
		handleAgentSettled("s3");
		expect(openBrowserTab).toHaveBeenCalledTimes(2);
		expect(openBrowserTab).toHaveBeenLastCalledWith("http://localhost:5199");
	});

	it("候选一经 settle 即消费（不补旧账）", () => {
		noteToolOutput("s4", "http://localhost:5173/");
		handleAgentSettled("s4");
		expect(openBrowserTab).toHaveBeenCalledTimes(1);

		handleAgentSettled("s4");
		expect(openBrowserTab).toHaveBeenCalledTimes(1);
	});

	it("侧栏已有同 URL 的浏览器 tab → 不重复开", () => {
		sidePaneState.owners = [
			{ sessionId: "s5", tabs: [{ id: "b0", kind: "browser", payload: { url: "http://localhost:5173" } }] },
		];
		noteToolOutput("s5", "http://localhost:5173/");
		handleAgentSettled("s5");
		expect(openBrowserTab).not.toHaveBeenCalled();
	});

	it("提取不到 URL 的输出不覆盖前面登记的有效候选", () => {
		noteToolOutput("s6", "http://localhost:5173/");
		noteToolOutput("s6", "no url here");
		handleAgentSettled("s6");
		expect(openBrowserTab).toHaveBeenCalledWith("http://localhost:5173");
	});
});

describe("isLocalPreviewUrl", () => {
	it("本机地址（任意端口/协议）→ true；外网与非法值 → false", () => {
		expect(isLocalPreviewUrl("http://localhost:5173")).toBe(true);
		expect(isLocalPreviewUrl("http://127.0.0.1:8080/app")).toBe(true);
		expect(isLocalPreviewUrl("https://0.0.0.0:443")).toBe(true);
		expect(isLocalPreviewUrl("https://example.com:443")).toBe(false);
		expect(isLocalPreviewUrl("")).toBe(false);
		expect(isLocalPreviewUrl("not a url")).toBe(false);
	});
});

describe("handleAgentSettled 的自动刷新", () => {
	beforeEach(() => {
		openBrowserTab.mockClear();
		sidePaneState.reloadTab.mockClear();
		sidePaneState.owners = [];
	});

	it("本轮动过手 → 刷新该会话所有本机预览 tab（外网 tab 不动）", () => {
		sidePaneState.owners = [
			{
				sessionId: "r1",
				tabs: [
					{ id: "b1", kind: "browser", payload: { url: "http://localhost:5173" } },
					{ id: "b2", kind: "browser", payload: { url: "https://example.com" } },
					{ id: "t1", kind: "terminal", payload: {} },
				],
			},
		];
		noteToolActivity("r1", "write");
		handleAgentSettled("r1");
		expect(sidePaneState.reloadTab).toHaveBeenCalledTimes(1);
		expect(sidePaneState.reloadTab).toHaveBeenCalledWith("b1");
	});

	it("纯问答轮（没跑过 bash/write/edit）不刷", () => {
		sidePaneState.owners = [
			{ sessionId: "r2", tabs: [{ id: "b3", kind: "browser", payload: { url: "http://localhost:5173" } }] },
		];
		handleAgentSettled("r2");
		expect(sidePaneState.reloadTab).not.toHaveBeenCalled();
	});

	it("候选 URL 已有对应 tab：只刷新、不再自动开新 tab", () => {
		sidePaneState.owners = [
			{ sessionId: "r4", tabs: [{ id: "b5", kind: "browser", payload: { url: "http://localhost:5173" } }] },
		];
		noteToolActivity("r4", "bash");
		noteToolOutput("r4", "Local: http://localhost:5173/");
		handleAgentSettled("r4");
		expect(sidePaneState.reloadTab).toHaveBeenCalledTimes(1);
		expect(openBrowserTab).not.toHaveBeenCalled();
	});

	it("刷新先于自动打开：新候选无对应 tab 时开新 tab、不刷", () => {
		noteToolActivity("r5", "bash");
		noteToolOutput("r5", "Local: http://localhost:5199/");
		handleAgentSettled("r5");
		expect(sidePaneState.reloadTab).not.toHaveBeenCalled();
		expect(openBrowserTab).toHaveBeenCalledWith("http://localhost:5199");
	});
});

describe("toolResultText", () => {
	it("拼接 content 文本块，忽略非文本块与脏值", () => {
		expect(
			toolResultText({
				content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }],
			}),
		).toBe("a\nb");
		expect(toolResultText(null)).toBe("");
		expect(toolResultText("plain")).toBe("plain");
	});

	it("字符串 / output / text 字段形状都认（end 事件 result 形状随 SDK 版本漂移的兜底）", () => {
		expect(toolResultText({ output: "out" })).toBe("out");
		expect(toolResultText({ text: "t" })).toBe("t");
		expect(toolResultText(42)).toBe("");
	});
});
