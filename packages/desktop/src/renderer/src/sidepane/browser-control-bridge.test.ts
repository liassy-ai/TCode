import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Req = Record<string, unknown>;
type Res = { id: string; result: Record<string, unknown> };

const subscribers = new Set<(req: Req) => void>();
const eventSubscribers = new Set<(payload: { sessionId: string; event: { type: string } }) => void>();
const responses: Res[] = [];
const guestCalls: Array<{ method: string; params: unknown }> = [];
let guestReply: { ok: boolean; result?: unknown; error?: string } = { ok: true, result: {} };

const timeouts: Array<() => void> = [];

vi.mock("../api", () => ({
	getPi: () => ({
		onBrowserControlRequest: (cb: (req: Req) => void) => {
			subscribers.add(cb);
			return () => {
				subscribers.delete(cb);
			};
		},
		onEvent: (cb: (payload: { sessionId: string; event: { type: string } }) => void) => {
			eventSubscribers.add(cb);
			return () => {
				eventSubscribers.delete(cb);
			};
		},
		respondBrowserControl: async (payload: Res) => {
			responses.push(payload);
		},
		invokeBrowserGuest: async (payload: { method: string; params: unknown }) => {
			guestCalls.push({ method: payload.method, params: payload.params });
			return guestReply;
		},
	}),
}));

function fireAgentSettled(sessionId = SESSION) {
	for (const cb of eventSubscribers) cb({ sessionId, event: { type: "agent_settled" } });
}

(globalThis as unknown as { window: unknown }).window = {
	setTimeout: (cb: () => void) => {
		timeouts.push(cb);
		return timeouts.length;
	},
	clearTimeout: () => {},
};

import { DEFAULT_WINDOW_PRESET } from "@tcode/shared";
import {
	CURSOR_HIDE_AFTER_MS,
	clearGuestViewportEmulation,
	initBrowserControlBridge,
	resetBrowserViewport,
	setBrowserViewport,
	setDesktopViewport,
} from "./browser-control-bridge";
import {
	autoZoomFor,
	DESKTOP_SIZE,
	frameSizeFor,
	useBrowserViewportStore,
	zoomValuesOf,
} from "./browser-viewport";
import { registerBrowserWebview } from "./browser-webviews";
import { useSidePaneStore } from "./store";

const SESSION = "sess-1";
let reloadCount = 0;

let probeHittable = true;

let typeKind = "input";

let typeFocused = true;

let typeWrote = true;

const injected: string[] = [];

function fakeWebview() {
	return {
		clientWidth: 466,
		executeJavaScript: async (code: string) => {
			injected.push(code);
			if (code.includes("__tcodeNetIdleN")) return { ok: true };

			if (code.includes('"#nope"')) return { missing: "选择器没有匹配到任何元素" };

			if (code.includes("elementFromPoint")) {
				return { x: 10, y: 20, label: "<button>「ok」", hittable: probeHittable, covering: "div.overlay" };
			}

			if (code.includes('let kind = "other"')) return { kind: typeKind, focused: typeFocused };

			if (code.includes("trim().length > 0")) return typeWrote;
			if (code.includes("getBoundingClientRect")) return { x: 10, y: 20 };
			return { title: "T", url: "http://example.com/", text: "hello", truncated: false };
		},
		loadURL: async () => {},
		reload: () => {
			reloadCount += 1;
		},
		getURL: () => "http://example.com/",
		getTitle: () => "T",
		isLoading: () => false,
		getWebContentsId: () => 42,
	};
}

function addTab(discriminator: string): string {
	const tabId = useSidePaneStore.getState().openTab({
		kind: "browser",
		discriminator,
		title: discriminator,
		payload: { url: "http://example.com/" },
		ownerSessionId: SESSION,
	});
	registerBrowserWebview(tabId, fakeWebview() as unknown as HTMLElement);
	return tabId;
}

function browserTabs() {
	return (useSidePaneStore.getState().owners.find((owner) => owner.sessionId === SESSION)?.tabs ?? []).filter(
		(tab) => tab.kind === "browser",
	);
}

function overrideOf(tabId: string) {
	return useBrowserViewportStore.getState().overrides[tabId];
}

function frameOf(tabId: string) {
	return useBrowserViewportStore.getState().frames[tabId] ?? "auto";
}

const observed: Record<string, unknown> = {};

async function run(op: string, extra: Req = {}): Promise<Record<string, unknown>> {
	responses.length = 0;

	for (const cb of [...subscribers]) cb({ id: `r-${op}`, sessionId: SESSION, op, ...extra });

	await new Promise((resolve) =>
		setTimeout(resolve, op === "click" || op === "type" || op === "hover" ? 700 : 60),
	);
	const result = responses[responses.length - 1]?.result ?? {};
	observed[op] = result;
	return result;
}

async function dispatch(sessionId: string, op: string, extra: Req = {}): Promise<Record<string, unknown>> {
	responses.length = 0;
	for (const cb of [...subscribers]) cb({ id: `r-${op}`, sessionId, op, ...extra });
	await new Promise((resolve) => setTimeout(resolve, 60));
	return responses[responses.length - 1]?.result ?? {};
}

afterAll(() => {
	console.log(`OBSERVED_RESULTS=${JSON.stringify(observed)}`);
});
beforeEach(() => {
	reloadCount = 0;
	probeHittable = true;
	typeKind = "input";
	typeFocused = true;
	typeWrote = true;
	injected.length = 0;
	guestCalls.length = 0;
	guestReply = { ok: true, result: {} };
	useSidePaneStore.setState({ owners: [], cwd: null, sessionId: null, reloadTicks: {} });
	useBrowserViewportStore.setState({ overrides: {}, frames: {}, zoomValues: {}, modes: {} });
	useSidePaneStore.getState().setOwner("E:\\test", SESSION);
	addTab(`http://example.com/-${Math.random()}`);
	initBrowserControlBridge();
});

describe("AI 浏览器控制桥：初始化幂等（StrictMode 双跑）", () => {
	it("重复初始化后退订旧的，一次请求只处理一次", () => {
		initBrowserControlBridge();
		expect(subscribers.size).toBe(1);
	});

	it("重复初始化不会让一次 click 变成两次动作", async () => {
		initBrowserControlBridge();
		const res = await run("click", { selector: "#btn" });
		expect(res.action).toBe("click");
		expect(guestCalls.filter((call) => call.method === "click").length).toBe(1);
	});
});

describe("AI 浏览器控制桥：注入页面的脚本", () => {
	it("光标脚本语法合法（模板插值 / 转义没把字符串拼坏）", async () => {
		await run("click", { selector: "#btn" });
		const cursor = injected.find((code) => code.includes("__tcodeCursor"));
		expect(cursor).toBeTruthy();

		expect(() => new Function(cursor as string)).not.toThrow();
		expect(cursor).toContain("cubic-bezier(.22,.61,.36,1)");
	});
});

describe("AI 浏览器控制桥：内容与导航", () => {
	it("read 返回页面内容", async () => {
		const res = await run("read");
		expect(res.kind).toBe("page");
		expect(res.text).toBe("hello");
	});

	it("list 返回本会话的浏览器 tab", async () => {
		const res = await run("list");
		expect(res.kind).toBe("tabs");
		expect((res.tabs as unknown[]).length).toBe(1);
	});

	it("open 拒绝空地址（不再开出 about:blank 空白 tab）", async () => {
		const res = await run("open", { url: "" });
		expect(res.ok).toBe(false);
	});

	it("reload 真的重载页面并返回 reloaded", async () => {
		const res = await run("reload");
		expect(reloadCount).toBeGreaterThan(0);
		expect(res.kind).toBe("reloaded");
	});
});

describe("AI 浏览器控制桥：main 侧真实输入 / CDP 动作不再掉进 read", () => {
	it("keys 走真实输入并返回 acted", async () => {
		guestReply = { ok: true, result: { keyCode: "Enter" } };
		const res = await run("keys", { key: "Enter" });
		expect(guestCalls.map((call) => call.method)).toContain("keys");
		expect(res.kind).toBe("acted");
		expect(res.action).toBe("keys");
	});

	it("screenshot 只回「截哪个页面」+ 显示尺寸，不把图片带回渲染层（图留在 main 就地截）", async () => {
		const res = await run("screenshot", {});
		expect(res.kind).toBe("shot");

		expect(guestCalls.map((call) => call.method)).not.toContain("screenshot");
		expect(res.webContentsId).toBe(42);
		expect(res.base64).toBeUndefined();
	});

	it("resize 改容器尺寸并返回 resized", async () => {
		const res = await run("resize", { width: 375, height: 800 });
		expect(res.kind).toBe("resized");
		expect(res.width).toBe(375);
	});

	it("hover 先滚进视口再量坐标，再走 CDP 真实鼠标移动（元素在折叠线以下也看得见光标）", async () => {
		const res = await run("hover", { selector: "body" });

		expect(injected.some((code) => code.includes("elementFromPoint"))).toBe(true);

		expect(injected.some((code) => code.includes("__tcodeCursor"))).toBe(true);
		const cdp = guestCalls.find((call) => call.method === "cdp");
		expect(cdp?.params).toMatchObject({
			method: "Input.dispatchMouseEvent",
			params: { type: "mouseMoved", x: 10, y: 20 },
		});
		expect(res.action).toBe("hover");
	});

	it("hover 找不到元素时如实报错（不再静默移到 0,0）", async () => {
		const res = await run("hover", { selector: "#nope" });
		expect(res.ok).toBe(false);
		expect(String(res.error)).toContain("选择器没有匹配到任何元素");
	});

	it("scroll 返回 acted", async () => {
		const res = await run("scroll", { dy: 100 });
		expect(res.action).toBe("scroll");
	});

	it("console 回传日志并给出真实 dropped 数", async () => {
		const many = Array.from({ length: 100 }, (_, i) => ({ level: "log", text: `line-${i}` }));
		guestReply = { ok: true, result: { logs: many } };
		const res = await run("console", {});
		expect(res.kind).toBe("logs");
		expect((res.logs as unknown[]).length).toBe(80);
		expect(res.dropped).toBe(20);
	});

	it("cdp 透传返回结果文本", async () => {
		guestReply = { ok: true, result: { foo: "bar" } };
		const res = await run("cdp", { method: "Page.getLayoutMetrics" });
		expect(res.kind).toBe("cdp");
		expect(String(res.result)).toContain("foo");
	});

	it("wait 尊重 selector 条件", async () => {
		const res = await run("wait", { selector: "body", timeout: 500 });
		expect(res.action).toBe("wait");
	});

	it("wait 尊重 idle:network", async () => {
		const res = await run("wait", { idle: "network", timeout: 500 });
		expect(observed.wait).toBe(res);
		expect(res.action).toBe("wait");
	});
});

describe("AI 浏览器控制桥：click/type 只走真实输入（没有合成事件兜底）", () => {
	it("click 走到 CDP 真实鼠标，detail 标出坐标", async () => {
		const res = await run("click", { selector: "#btn" });
		const guestClick = guestCalls.find((call) => call.method === "click");
		expect(guestClick).toBeTruthy();
		expect(guestClick?.params).toMatchObject({ x: 10, y: 20 });
		expect(res.ok).toBe(true);
		expect(String(res.detail)).toContain("真实鼠标");
	});

	it("点不到 → 失败，并说明被谁盖住（不再悄悄改成合成事件）", async () => {
		probeHittable = false;
		const res = await run("click", { selector: "#btn" });
		expect(res.ok).toBe(false);
		expect(String(res.error)).toContain("div.overlay");

		expect(String(res.error)).toContain("不要改用 script");

		expect(injected.some((code) => code.includes("dispatchEvent"))).toBe(false);
		expect(guestCalls.some((call) => call.method === "click")).toBe(false);
	});

	it("真实鼠标调用失败 → 失败上报，不换一种方式硬点", async () => {
		guestReply = { ok: false, error: "附加失败" };
		const res = await run("click", { selector: "#btn" });
		expect(res.ok).toBe(false);
		expect(String(res.error)).toContain("真实鼠标点击失败");
		expect(injected.some((code) => code.includes("dispatchEvent"))).toBe(false);
	});

	it("type 到输入框走 CDP insertText", async () => {
		const res = await run("type", { selector: "#name", text: "hello" });
		const guestType = guestCalls.find((call) => call.method === "type");
		expect(guestType?.params).toMatchObject({ text: "hello" });
		expect(res.ok).toBe(true);
		expect(String(res.detail)).toContain("已填入");
	});

	it("type 的 submit 透传给 main（由它发真实 Enter）", async () => {
		await run("type", { selector: "#name", text: "hi", submit: true });
		const guestType = guestCalls.find((call) => call.method === "type");
		expect(guestType?.params).toMatchObject({ submit: true });
	});

	it("目标是 select → 失败并指路（没有文本输入语义）", async () => {
		typeKind = "select";
		const res = await run("type", { selector: "#pick", text: "a" });
		expect(res.ok).toBe(false);
		expect(String(res.error)).toContain("select");

		expect(String(res.error)).toContain("keys");
		expect(String(res.error)).not.toContain("script");
		expect(injected.some((code) => code.includes("dispatchEvent"))).toBe(false);
	});

	it("聚焦不了 → 失败，不绕过焦点硬写", async () => {
		typeFocused = false;
		const res = await run("type", { selector: "#name", text: "x" });
		expect(res.ok).toBe(false);
		expect(String(res.error)).toContain("聚焦不了");
		expect(guestCalls.some((call) => call.method === "type")).toBe(false);
	});

	it("文本没落进去 → 失败上报（不靠改 value 假装成功）", async () => {
		typeWrote = false;
		const res = await run("type", { selector: "#name", text: "x" });
		expect(res.ok).toBe(false);
		expect(String(res.error)).toContain("没有写进");
	});

	it("选择器没命中时如实报错", async () => {
		const res = await run("click", { selector: "#nope" });
		expect(res.ok).toBe(false);
		expect(String(res.error)).toContain("没有匹配到任何元素");
	});
});

describe("AI 浏览器控制桥：close", () => {
	it("close 关掉目标 tab", async () => {
		await run("close", {});
		expect(browserTabs().length).toBe(0);
	});

	it("close({all:true}) 关闭本会话全部浏览器 tab", async () => {
		addTab(`http://second.example/-${Math.random()}`);
		expect(browserTabs().length).toBe(2);
		await run("close", { all: true });
		expect(browserTabs().length).toBe(0);
	});

	it("关掉的 tab 不再留视口覆盖（否则面板上那行提示撤不掉）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		await run("resize", { width: 1280, height: 800 });
		expect(overrideOf(tabId)).toBeTruthy();
		await run("close", { tabId });
		expect(overrideOf(tabId)).toBeUndefined();
	});
});

describe("容器尺寸：只改页面排版的空间，盒子里有多大 guest 视口就有多大", () => {
	function sizedResizeCalls() {
		return guestCalls.filter(
			(call) => call.method === "resize" && (call.params as { width?: number }).width !== undefined,
		);
	}

	it("resize 宽容器：登记尺寸，不需要给 guest 发尺寸（盒子就是视口）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		const res = await run("resize", { width: 1280, height: 800 });
		expect(res.kind).toBe("resized");
		expect(res.width).toBe(1280);

		expect(sizedResizeCalls()).toEqual([]);
		expect(overrideOf(tabId)).toMatchObject({ width: 1280, height: 800 });
		expect(overrideOf(tabId)).not.toHaveProperty("scale");
	});

	it("resize 窄容器：同样只是尺寸（响应式验证要看到真实渲染）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		await run("resize", { width: 375, height: 800 });
		expect(sizedResizeCalls()).toEqual([]);
		expect(overrideOf(tabId)).toMatchObject({ width: 375, height: 800 });
	});

	it("resize reset：撤销尺寸后回到所在模式的默认——可调节窗口 = 1280×800", async () => {
		const tabId = browserTabs()[0]?.id as string;
		await run("resize", { width: 1600, height: 900 });
		expect(overrideOf(tabId)).toBeTruthy();
		const res = await run("resize", { reset: true });
		expect(overrideOf(tabId)).toBeUndefined();
		expect(res).toMatchObject({ width: DEFAULT_WINDOW_PRESET.width, height: DEFAULT_WINDOW_PRESET.height });
	});

	it("reset：撤销后回执报的是桌面版档的默认 1280×800（尺寸只在那一档，清掉即回到它）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		await run("resize", { width: 1600, height: 900 });
		useBrowserViewportStore.getState().setMode(tabId, "fit");
		const res = await run("resize", { reset: true });
		expect(overrideOf(tabId)).toBeUndefined();
		expect(res).toMatchObject({ width: DESKTOP_SIZE.width, height: DESKTOP_SIZE.height });
	});

	it("面板上的撤销按钮不必等 AI：直接清尺寸", async () => {
		const tabId = browserTabs()[0]?.id as string;
		await run("resize", { width: 900, height: 700 });
		expect(overrideOf(tabId)).toBeTruthy();
		const res = resetBrowserViewport(tabId);
		expect(res.ok).toBe(true);
		expect(overrideOf(tabId)).toBeUndefined();
	});

	it("撤销是纯状态操作：没有 guest 也不失败（尺寸是盒子的属性，不依赖实例）", () => {
		const res = resetBrowserViewport("browser-missing");
		expect(res.ok).toBe(true);
	});

	it("清残留视口仿真：给 guest 发一次 reset，且不发尺寸", async () => {
		await clearGuestViewportEmulation(browserTabs()[0]?.id as string);
		const params = guestCalls.filter((call) => call.method === "resize").at(-1)?.params as {
			reset?: boolean;
		};
		expect(params?.reset).toBe(true);
	});

	it("清残留仿真失败不算事（实例没挂载时静默）", async () => {
		await expect(clearGuestViewportEmulation("browser-missing")).resolves.toBeUndefined();
	});
});

describe("视口条：用户手填容器宽 / 高", () => {
	it("填宽 / 高只改状态：盒子是视口，不必给 guest 发尺寸（清理残留仿真的 reset 会带一次）", () => {
		const tabId = browserTabs()[0]?.id as string;
		const res = setBrowserViewport(tabId, { width: 1280, height: 800 });
		expect(res.ok).toBe(true);
		expect(guestCalls.filter((call) => call.method === "resize" && call.params !== undefined)).toEqual([
			{ method: "resize", params: { reset: true } },
		]);
		expect(overrideOf(tabId)).toMatchObject({ width: 1280, height: 800, source: "user" });
	});

	it("AI 的 resize 登记成 source:ai（面板据此区分是谁设的）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		await run("resize", { width: 375, height: 800 });
		expect(overrideOf(tabId)?.source).toBe("ai");
	});

	it("宽高非正 → 直接报错，不登记尺寸", () => {
		const tabId = browserTabs()[0]?.id as string;
		const res = setBrowserViewport(tabId, { width: 0, height: 800 });
		expect(res.ok).toBe(false);
		expect(overrideOf(tabId)).toBeUndefined();
	});

	it("撤销尺寸不动页面缩放：缩放是用户自己的视图偏好，不该被撤销掉", async () => {
		const tabId = browserTabs()[0]?.id as string;
		await run("resize", { width: 1280, height: 800 });
		useBrowserViewportStore.getState().setZoomValue(tabId, "desktop", 1.5);
		resetBrowserViewport(tabId);
		expect(overrideOf(tabId)).toBeUndefined();
		expect(zoomValuesOf(tabId).desktop).toBe(1.5);
	});
});

describe("视口条：选「桌面版」那一档", () => {
	it("切到桌面版档：容器按 1280×800 排版，显示缩到装得下", () => {
		const tabId = browserTabs()[0]?.id as string;
		const res = setDesktopViewport(tabId);
		expect(res.ok).toBe(true);
		expect(frameOf(tabId)).toBe("desktop");

		expect(guestCalls.filter((call) => call.method === "resize" && call.params !== undefined)).toEqual([]);

		const frame = frameSizeFor(overrideOf(tabId), "desktop", { width: 452, height: 408 });
		expect(frame).toEqual({ width: 1280, height: 800 });
		const scale = autoZoomFor(452, 408, frame.width, frame.height);
		expect(Math.round(frame.width * scale)).toBeLessThanOrEqual(452);
	});

	it("先被 AI 改过尺寸，再选桌面版：容器回到 1280×800（设过的尺寸清掉）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		await run("resize", { width: 1600, height: 900 });
		expect(overrideOf(tabId)).toBeTruthy();
		setDesktopViewport(tabId);
		expect(overrideOf(tabId)).toBeUndefined();
		expect(frameOf(tabId)).toBe("desktop");
	});

	it("选桌面版会打开「可调节窗口」（视口条只在那一档出现）", () => {
		const tabId = browserTabs()[0]?.id as string;
		expect(useBrowserViewportStore.getState().modes[tabId] ?? "fit").toBe("fit");
		setDesktopViewport(tabId);
		expect(useBrowserViewportStore.getState().modes[tabId]).toBe("manual");
	});

	it("在桌面版档里填宽 / 高：只改排版尺寸，容器档不动", () => {
		const tabId = browserTabs()[0]?.id as string;
		setDesktopViewport(tabId);
		setBrowserViewport(tabId, { width: 900, height: 700 });
		expect(overrideOf(tabId)).toMatchObject({ width: 900, height: 700 });
		expect(frameOf(tabId)).toBe("desktop");
	});
});

describe("改宽 / 高只可能发生在可调节窗口模式下（AI 也得走「打开窗口调节」）", () => {
	function modeOf(tabId: string) {
		return useBrowserViewportStore.getState().modes[tabId] ?? "fit";
	}

	it("AI 的 resize 先把面板切到可调节窗口，再落尺寸", async () => {
		const tabId = browserTabs()[0]?.id as string;
		expect(modeOf(tabId)).toBe("fit");
		await run("resize", { width: 375, height: 800 });
		expect(modeOf(tabId)).toBe("manual");
		expect(overrideOf(tabId)).toMatchObject({ width: 375, height: 800, source: "ai" });
	});

	it("用户手填尺寸同样把模式切到可调节（这条不变量两条路都守）", () => {
		const tabId = browserTabs()[0]?.id as string;
		setBrowserViewport(tabId, { width: 900, height: 700 });
		expect(modeOf(tabId)).toBe("manual");
	});

	it("AI 只撤销尺寸时不抢模式（撤销不是调比例，用户开着的那一栏别给他关掉）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		useBrowserViewportStore.getState().setMode(tabId, "fit");
		await run("resize", { width: 1280, height: 800 });
		expect(modeOf(tabId)).toBe("manual");
		await run("resize", { reset: true });
		expect(overrideOf(tabId)).toBeUndefined();
		expect(modeOf(tabId)).toBe("manual");
	});

	it("尺寸非法时不切模式、也不登记尺寸（没改成的东西不许留下痕迹）", () => {
		const tabId = browserTabs()[0]?.id as string;
		const res = setBrowserViewport(tabId, { width: 0, height: 700 });
		expect(res.ok).toBe(false);
		expect(modeOf(tabId)).toBe("fit");
		expect(overrideOf(tabId)).toBeUndefined();
	});
});

describe("改尺寸：尺寸只跟「桌面版」档有关，改了就把容器档切过去", () => {
	it("面板上填宽 / 高：原本是自适应档 → 切到桌面版档", () => {
		const tabId = browserTabs()[0]?.id as string;
		expect(frameOf(tabId)).toBe("auto");
		setBrowserViewport(tabId, { width: 375, height: 800 });
		expect(frameOf(tabId)).toBe("desktop");
	});

	it("AI 的 resize：原本是自适应窗口（默认）→ 同样切到桌面版档", async () => {
		const tabId = browserTabs()[0]?.id as string;
		await run("resize", { width: 1280, height: 800 });
		expect(frameOf(tabId)).toBe("desktop");
	});

	it("改尺寸只换档，不动用户设的页面缩放（两档各存一份）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		useBrowserViewportStore.getState().setMode(tabId, "manual");
		useBrowserViewportStore.getState().setZoomValue(tabId, "desktop", 1.5);
		await run("resize", { width: 375, height: 800 });
		expect(frameOf(tabId)).toBe("desktop");
		expect(zoomValuesOf(tabId).desktop).toBe(1.5);
	});

	it("撤销尺寸不动容器档（切回自适应是用户的事，撤销只管尺寸）", () => {
		const tabId = browserTabs()[0]?.id as string;
		setBrowserViewport(tabId, { width: 900, height: 700 });
		expect(frameOf(tabId)).toBe("desktop");
		useBrowserViewportStore.getState().setFrame(tabId, "auto");
		resetBrowserViewport(tabId);
		expect(frameOf(tabId)).toBe("auto");
	});
});

describe("AI 浏览器控制桥：会话归属（谁的任务只动谁的侧栏）", () => {
	function otherSessionTab(): { sessionId: string; tabId: string } {
		const sessionId = "01a13d57-79ce-af72-beca136f16e2";
		useSidePaneStore.getState().setOwner("E:\\other", sessionId);
		const tabId = useSidePaneStore.getState().openTab({
			kind: "browser",
			discriminator: "other",
			title: "other",
			payload: { url: "http://other.test/" },
			ownerSessionId: sessionId,
		});
		registerBrowserWebview(tabId, fakeWebview() as unknown as HTMLElement);
		return { sessionId, tabId };
	}

	it("后台会话 A 的操作只落在 A 的侧栏：当前会话 B 的 tab 一点没动", async () => {
		const { sessionId: other, tabId: otherTab } = otherSessionTab();
		const mine = browserTabs()[0]?.id as string;

		const res = await dispatch(other, "read", {});
		expect(res.ok).toBe(true);

		expect(frameOf(otherTab)).toBe("desktop");
		expect(frameOf(mine)).toBe("auto");
	});

	it("「AI 当前标签」记在它自己的会话名下，不污染当前会话", async () => {
		const { sessionId: other, tabId: otherTab } = otherSessionTab();
		await dispatch(other, "read", {});

		const listed = await dispatch(other, "list", {});
		const rows = listed.tabs as { id: string; current: boolean }[];
		expect(rows.find((tab) => tab.id === otherTab)?.current).toBe(true);

		const mineListed = await run("list", {});
		const mineRows = mineListed.tabs as { id: string; current: boolean }[];
		expect(mineRows.some((tab) => tab.current)).toBe(false);
	});

	it("没有会话归属的请求直接拒绝（不再回落到「当前显示的会话」）", async () => {
		const mine = browserTabs()[0]?.id as string;
		const res = await dispatch("", "read", {});
		expect(res.ok).toBe(false);
		expect(String(res.error)).toContain("会话归属");

		expect(frameOf(mine)).toBe("auto");
	});
});

describe("AI 操作的档位租约：本次回复首次操作切桌面版、整次回复持有、agent_settled 放回用户那一档", () => {
	function userOnAutoAt150(tabId: string) {
		const store = useBrowserViewportStore.getState();
		store.setMode(tabId, "manual");
		store.setFrame(tabId, "auto");
		store.setZoomValue(tabId, "auto", 1.5);
	}

	it("本次回复首次操作切到桌面版；同一次回复里再操作不会翻回去；agent_settled 才放回用户那一档", async () => {
		const tabId = browserTabs()[0]?.id as string;
		userOnAutoAt150(tabId);
		await run("read", {});
		expect(frameOf(tabId)).toBe("desktop");
		await run("read", {});
		expect(frameOf(tabId)).toBe("desktop");
		fireAgentSettled();
		expect(frameOf(tabId)).toBe("auto");
	});

	it("收工不碰缩放：用户自己设的 150% 原样还在（缩放只有用户能改）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		userOnAutoAt150(tabId);
		await run("read", {});
		fireAgentSettled();
		expect(frameOf(tabId)).toBe("auto");
		expect(zoomValuesOf(tabId)).toEqual({ auto: 1.5, desktop: 1 });
	});

	it("用户没自定义缩放：收工后两档都还是默认（80% / 100%），没有凭空平移", async () => {
		const tabId = browserTabs()[0]?.id as string;
		useBrowserViewportStore.getState().setMode(tabId, "manual");
		await run("read", {});
		fireAgentSettled();
		expect(frameOf(tabId)).toBe("auto");
		expect(zoomValuesOf(tabId)).toEqual({ auto: 0.8, desktop: 1 });
	});

	it("用户本来就停在桌面版档：档位不动，用户设的缩放原样还在", async () => {
		const tabId = browserTabs()[0]?.id as string;
		const store = useBrowserViewportStore.getState();
		store.setMode(tabId, "manual");
		store.setFrame(tabId, "desktop");
		store.setZoomValue(tabId, "desktop", 1.25);
		await run("read", {});
		fireAgentSettled();
		expect(frameOf(tabId)).toBe("desktop");
		expect(zoomValuesOf(tabId).desktop).toBe(1.25);
	});

	it("持有期间用户自己换过档：收工不覆盖用户的选择", async () => {
		const tabId = browserTabs()[0]?.id as string;
		const store = useBrowserViewportStore.getState();
		store.setMode(tabId, "manual");
		store.setFrame(tabId, "desktop");
		await run("read", {});
		expect(frameOf(tabId)).toBe("desktop");
		store.setFrame(tabId, "auto");
		fireAgentSettled();
		expect(frameOf(tabId)).toBe("auto");
	});

	it("agent_settled 没到（运行被强杀）：兜底定时器到点也放回，不把面板卡在桌面版", async () => {
		const tabId = browserTabs()[0]?.id as string;
		userOnAutoAt150(tabId);
		const before = timeouts.length;
		await run("read", {});
		expect(frameOf(tabId)).toBe("desktop");
		timeouts[before]?.();
		expect(frameOf(tabId)).toBe("auto");
	});

	it("AI 的 resize 之后：尺寸留着（override 还在），档位留在桌面版（AI 自己要的那一档，收工不还）", async () => {
		const tabId = browserTabs()[0]?.id as string;
		userOnAutoAt150(tabId);
		await run("resize", { width: 1024, height: 768 });
		expect(overrideOf(tabId)).toMatchObject({ width: 1024, height: 768 });
		fireAgentSettled();
		expect(frameOf(tabId)).toBe("desktop");
	});
});

function installCursorDom() {
	const makeEl = () => {
		const el = {
			id: "",
			style: {} as Record<string, string>,
			children: [] as unknown[],
			isConnected: true,
			offsetWidth: 0,
			innerHTML: "",
			appendChild(child: unknown) {
				el.children.push(child);
				return child;
			},
			remove() {
				el.isConnected = false;
			},
		};
		return el;
	};
	const g = globalThis as unknown as { document?: unknown; window: Record<string, unknown> };
	const prevDocument = g.document;
	const body = makeEl();
	g.document = { getElementById: () => null, createElement: () => makeEl(), body, documentElement: body };
	g.window.innerWidth = 800;
	g.window.innerHeight = 600;
	return () => {
		g.document = prevDocument;
		delete g.window.__tcodeCursor;
		delete g.window.innerWidth;
		delete g.window.innerHeight;
	};
}

type CursorHandle = {
	root: { style: Record<string, string> };
	move: (x: number, y: number, click: boolean) => void;
};

describe("AI 光标：停手 5 秒自动淡出（不留假指针挂在页面上）", () => {
	it("移动后可见，满 5 秒淡出；再来一次动作立刻拉回并重新计时", async () => {
		await run("click", { selector: "#btn" });
		const script = injected.find((code) => code.includes("__tcodeCursor"));
		expect(script).toBeTruthy();

		const restoreDom = installCursorDom();
		vi.useFakeTimers();
		try {
			new Function(script as string)();
			const cursor = (globalThis as unknown as { window: { __tcodeCursor: CursorHandle } }).window
				.__tcodeCursor;
			expect(cursor.root.style.opacity).toBe("1");

			vi.advanceTimersByTime(CURSOR_HIDE_AFTER_MS - 1);
			expect(cursor.root.style.opacity).toBe("1");
			vi.advanceTimersByTime(1);
			expect(cursor.root.style.opacity).toBe("0");

			cursor.move(30, 40, false);
			expect(cursor.root.style.opacity).toBe("1");
			vi.advanceTimersByTime(CURSOR_HIDE_AFTER_MS);
			expect(cursor.root.style.opacity).toBe("0");
		} finally {
			vi.useRealTimers();
			restoreDom();
		}
	});
});
