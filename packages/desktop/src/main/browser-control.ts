import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { BrowserControlRequest, BrowserControlResult, BrowserControlTabInfo } from "@tcode/shared";
import { describeWindowPresets, IpcChannels, windowPresetById } from "@tcode/shared";
import { app } from "electron";
import { Type } from "typebox";
import { invokeGuest } from "./browser-guest";
import { findScriptPointerViolation, scriptPointerRejection } from "./browser-script-guard";
import { loadUiState } from "./ui-state";
import { getMainWindow } from "./window";

const REQUEST_TIMEOUT_MS = 20_000;

const OP_PACE_MS = 100;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const SHOTS_KEEP = 2;

function saveShot(sessionId: string, base64: string): string {
	const dir = join(app.getPath("userData"), "browser-shots", sessionId || "unknown");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
	writeFileSync(file, Buffer.from(base64, "base64"));
	try {
		const files = readdirSync(dir)
			.filter((f) => f.endsWith(".png"))
			.map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
			.sort((a, b) => b.t - a.t);
		for (const { f } of files.slice(SHOTS_KEEP)) rmSync(join(dir, f), { force: true });
	} catch {}
	return file;
}

interface PendingRequest {
	settle: (result: BrowserControlResult) => void;
}

const pending = new Map<string, PendingRequest>();
let requestSeq = 0;

export function settleBrowserControl(id: string, result: BrowserControlResult): void {
	const entry = pending.get(id);
	if (!entry) return;
	pending.delete(id);
	entry.settle(result);
}

function requestRenderer(payload: Omit<BrowserControlRequest, "id">): Promise<BrowserControlResult> {
	return new Promise((resolve) => {
		const window = getMainWindow();
		if (!window) {
			resolve({ ok: false, error: "桌面窗口不可用（浏览器控制是桌面端专属功能）" });
			return;
		}
		const id = `bc-${++requestSeq}`;
		const timer = setTimeout(() => {
			pending.delete(id);
			resolve({ ok: false, error: "侧边浏览器响应超时" });
		}, REQUEST_TIMEOUT_MS);
		pending.set(id, {
			settle: (result) => {
				clearTimeout(timer);
				resolve(result);
			},
		});
		window.webContents.send(IpcChannels.BrowserControlRequest, {
			...payload,
			id,
		} satisfies BrowserControlRequest);
	});
}

const browserParams = Type.Object({
	action: Type.Union(
		[
			Type.Literal("list"),
			Type.Literal("read"),
			Type.Literal("open"),
			Type.Literal("reload"),
			Type.Literal("click"),
			Type.Literal("type"),
			Type.Literal("script"),
			Type.Literal("keys"),
			Type.Literal("resize"),
			Type.Literal("cdp"),
			Type.Literal("screenshot"),
			Type.Literal("console"),
			Type.Literal("wait"),
			Type.Literal("hover"),
			Type.Literal("scroll"),
			Type.Literal("close"),
		],
		{
			description:
				"要执行的动作：list / read / open / reload / click / type / script / keys / resize / cdp / screenshot / console / wait / hover / scroll / close（各动作含义见工具说明）",
		},
	),
	tab_id: Type.Optional(
		Type.String({
			description:
				"read / reload / click / type 的目标 tab（list 返回的 id）；缺省为 AI 当前标签（上次操作的 tab，没有则本会话激活的浏览器 tab）。open 时指定则跳转该既有 tab",
		}),
	),
	url: Type.Optional(Type.String({ description: "open 的目标地址（http/https/file）" })),
	new_tab: Type.Optional(
		Type.Boolean({
			description: "open 专用：true = 新建标签而非复用 AI 当前标签",
		}),
	),
	selector: Type.Optional(
		Type.String({ description: "read / click / type 的 CSS 选择器（read 缺省为整页；click / type 必填）" }),
	),
	index: Type.Optional(
		Type.Number({ description: "click / type：命中多个元素时取第几个（从 0 开始，缺省 0）" }),
	),
	text: Type.Optional(Type.String({ description: "type：要填入输入框的文本" })),
	submit: Type.Optional(Type.Boolean({ description: "type：填写后按 Enter 提交所在表单" })),
	code: Type.Optional(
		Type.String({
			description:
				'script：注入页面执行的 JS，仅用于读取与测量页面状态（取值、量尺寸、读样式、查看 DOM）；指针类动作请用 click / type / hover / scroll / keys。可用 await 与 return，例如 "return document.title"；返回值序列化为文本回传（上限 12k 字符）。脚本中出现 .click() / dispatchEvent / scrollIntoView / scrollTo / .value = 等页面操作将被直接拒绝，请改用对应 action',
		}),
	),
	key: Type.Optional(
		Type.String({
			description:
				'keys：键名（KeyboardEvent.key 语义），如 "Enter" / "Escape" / "Tab" / "ArrowDown" / "a"；经 main 发送真实输入（isTrusted=true），组合键用 modifiers',
		}),
	),
	modifiers: Type.Optional(
		Type.Array(
			Type.Union([Type.Literal("ctrl"), Type.Literal("alt"), Type.Literal("shift"), Type.Literal("meta")]),
			{
				description: "keys：修饰键，可任意组合（ctrl / alt / shift / meta）",
			},
		),
	),
	width: Type.Optional(
		Type.Number({
			description:
				"resize：容器宽（CSS px），用于响应式验证（如窄宽度下的侧栏行为）。会先开启「可调节窗口」再改尺寸",
		}),
	),
	height: Type.Optional(Type.Number({ description: "resize：容器高（CSS px）" })),
	preset: Type.Optional(
		Type.String({
			description: `resize：按预设名给尺寸（${describeWindowPresets()}）。预设仅为尺寸名称，不做 UA / 移动端仿真`,
		}),
	),
	reset: Type.Optional(
		Type.Boolean({
			description: "resize：true = 撤销尺寸设置，容器恢复为桌面版档的默认 1280×800",
		}),
	),
	method: Type.Optional(Type.String({ description: 'cdp：原始 CDP 方法名，如 "Page.captureScreenshot"' })),
	params: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "cdp：方法参数对象" })),
	clear: Type.Optional(Type.Boolean({ description: "console：true = 取回后清空缓冲" })),
	idle: Type.Optional(
		Type.Union([Type.Literal("load"), Type.Literal("network")], {
			description: "wait：等待加载完成（load）/ 网络空闲（network）",
		}),
	),
	timeout: Type.Optional(Type.Number({ description: "wait：超时毫秒（缺省 8000）" })),
	dx: Type.Optional(Type.Number({ description: "scroll：水平滚动像素" })),
	dy: Type.Optional(Type.Number({ description: "scroll：垂直滚动像素" })),
	behavior: Type.Optional(
		Type.Union([Type.Literal("auto"), Type.Literal("smooth")], { description: "scroll：滚动行为" }),
	),
	full_page: Type.Optional(Type.Boolean({ description: "screenshot：true = 整页" })),
	all: Type.Optional(Type.Boolean({ description: "close：true = 关闭本会话全部浏览器 tab" })),
	format: Type.Optional(
		Type.Union([Type.Literal("text"), Type.Literal("html")], {
			description: "read 的输出格式：text（可见文本，缺省）/ html（HTML 源码）",
		}),
	),
});

type BrowserResultView = Partial<{
	ok: boolean;
	kind: string;
	tabs: BrowserControlTabInfo[];
	url: string;
	title: string;
	text: string;
	truncated: boolean;
	tabId: string;
	loaded: boolean;
	action: string;
	detail: string;
	error: string;
	reset: boolean;
	result: string;
	method: string;

	webContentsId: number;
	width: number;
	height: number;
	logs: { level: string; text: string }[];
	dropped: number;
}>;

async function captureGuest(
	webContentsId: number | undefined,
	fullPage: boolean,
): Promise<{ ok: true; base64: string } | { ok: false; error: string }> {
	if (typeof webContentsId !== "number") return { ok: false, error: "截图失败：没有拿到页面句柄" };
	const out = await invokeGuest({ webContentsId, method: "screenshot", params: { full_page: fullPage } });
	if (!out.ok) return { ok: false, error: `截图失败：${out.error}` };
	const base64 = (out.result as { base64?: string } | undefined)?.base64 ?? "";
	if (!base64) return { ok: false, error: "截图失败：页面没有返回图像数据" };
	return { ok: true, base64 };
}
export function formatBrowserControlResult(result: BrowserControlResult): string {
	const r = result as unknown as BrowserResultView;
	if (r.ok === false) return `浏览器控制失败：${r.error ?? "未知错误"}`;
	switch (r.kind) {
		case "tabs":
			if ((r.tabs ?? []).length === 0) return "侧边浏览器还没有 tab。";
			return (
				"侧边浏览器 tabs：\n" +
				(r.tabs ?? [])
					.map(
						(tab) =>
							`- ${tab.id}${tab.current ? "（AI 当前）" : ""}${tab.active ? "（用户激活）" : ""} ${tab.title || "(无标题)"} — ${tab.url}`,
					)
					.join("\n")
			);
		case "page":
			return `页面（${r.title || "(无标题)"} · ${r.url}）${r.truncated ? "（文本已截断）" : ""}：\n${r.text}`;
		case "opened":
			return `已打开：${r.url}（tab ${r.tabId}${r.loaded ? "" : "，尚未加载完"}）`;
		case "reloaded":
			return `已刷新（tab ${r.tabId}）：${r.title || r.url}`;
		case "acted": {
			const verb =
				r.action === "click"
					? "已点击"
					: r.action === "type"
						? "已填入文本"
						: r.action === "keys"
							? "已发送按键"
							: "已完成";
			return `${verb}（tab ${r.tabId}）。${r.detail}`;
		}
		case "shot":
			return `已截图（${r.width ?? 0}×${r.height ?? 0}）。`;
		case "logs":
			return (r.logs ?? []).length === 0
				? "控制台无输出。"
				: `控制台输出：\n${(r.logs ?? []).map((l) => `[${l.level}] ${l.text}`).join("\n")}`;
		case "resized":
			return r.reset
				? r.width && r.height
					? `已撤销容器尺寸（tab ${r.tabId}），回到桌面版档的默认 ${r.width}×${r.height}。`
					: `已撤销容器尺寸（tab ${r.tabId}），容器回到面板大小（页面按面板宽度排版）。`
				: `已改容器尺寸并切到「桌面版」档（tab ${r.tabId}）：${r.width ?? 0}×${r.height ?? 0}。`;
		case "cdp":
			return `CDP 结果（tab ${r.tabId}${r.method ? ` · ${r.method}` : ""}）：${r.result ?? "(空)"}`;
		default:
			return r.detail ? `已完成。${r.detail}` : `已完成（${r.kind ?? "ok"}）。`;
	}
}

function sessionIdOf(ctx: unknown): string {
	try {
		const manager = (ctx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager;
		return manager?.getSessionId?.() ?? "";
	} catch {
		return "";
	}
}

export function makeBrowserControlTool(): ToolDefinition<typeof browserParams> {
	return defineTool({
		name: "browser",
		label: "浏览器控制",
		description:
			"读取 / 操作桌面端侧边栏的浏览器 tab（用户可见，可能带登录态）。" +
			"action：list = 列出本会话 tab；read = 抓取页面内容（format：text 可见文本 / html 源码）；open = 打开网址（默认复用 AI 当前 tab，new_tab = 新开）；" +
			"reload = 刷新；click = 点击元素（selector，命中多个时取 index）；type = 填输入框（selector + text，submit = 回车提交）；" +
			"script = 在页面中执行 JS（可用 await 与 return），仅用于读取与测量页面状态；keys = 发送真实键盘事件（isTrusted=true，用于 Esc / Tab / 方向键 / 组合键）；" +
			"cdp = 原始 CDP 透传（method / params）；screenshot = 截图回图；console = 取回页面日志；wait = 等待选择器 / 文本 / 加载；" +
			"hover / scroll = 真实鼠标移动与滚动（CSS :hover 必须依赖它）；close = 关闭 tab；resize = 设置容器尺寸（width / height 或 preset，见参数说明）。" +
			"指针类动作（scroll / click / hover / keys）一律使用内置 action，禁止以 script 的 scrollTo / .click() / dispatchEvent 代替。" +
			"容器尺寸仅决定页面排版（媒体查询 / 断点），不改变用户屏幕上显示的大小。" +
			"resize 会先开启「窗口调整」并将容器档切至桌面版（尺寸仅在该档生效，默认 1280×800）；reset=true 恢复为 1280×800。" +
			"selector 定位失败时先用 list / read 复核；自查页面改动时每轮至少执行一次真实指针动作。",
		parameters: browserParams,
		promptSnippet:
			'browser({action: "list" | "read" | "open" | "reload" | "click" | "type" | "script" | "keys" | "resize" | "cdp" | "screenshot" | "console" | "wait" | "hover" | "scroll" | "close", ...})',
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = await loadUiState().catch(() => null);
			if (state?.browserControl !== true) {
				return {
					content: [
						{
							type: "text" as const,
							text: "浏览器控制未开启：请在「设置 → 通用 → 浏览器控制」里打开后再试。",
						},
					],
					details: {},
				};
			}

			const { action, full_page, preset, ...rest } = params as typeof params & { full_page?: boolean };

			if (typeof action !== "string" || action.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: 'browser 调用缺少 action（参数为空）：请给出 action 与对应参数，例如 browser({action:"click", selector:"..."})。可用 action：list / read / open / reload / click / type / script / keys / resize / cdp / screenshot / console / wait / hover / scroll / close。',
						},
					],
					details: {},
				};
			}

			let size = { width: rest.width, height: rest.height };
			if (action === "resize" && typeof preset === "string" && preset.trim()) {
				const known = windowPresetById(preset);
				if (!known) {
					return {
						content: [
							{
								type: "text" as const,
								text: `不认识的窗口预设「${preset}」。可用：${describeWindowPresets()}（也可以直接给 width/height）`,
							},
						],
						details: {},
					};
				}
				size = { width: known.width, height: known.height };
			}

			if (action === "script" && typeof params.code === "string") {
				const violation = findScriptPointerViolation(params.code);
				if (violation) {
					return {
						content: [{ type: "text" as const, text: scriptPointerRejection(violation) }],
						details: {},
					};
				}
			}

			if (OP_PACE_MS > 0) await sleep(OP_PACE_MS);

			const result = await requestRenderer({
				...rest,
				...size,
				op: action,
				fullPage: full_page,
				sessionId: sessionIdOf(ctx),
			});
			const view = result as unknown as BrowserResultView;

			if (view.kind === "shot") {
				const shot = await captureGuest(view.webContentsId, full_page === true);
				if (!shot.ok) return { content: [{ type: "text" as const, text: shot.error }], details: {} };

				const shotPath = saveShot(sessionIdOf(ctx), shot.base64);
				return {
					content: [{ type: "text" as const, text: `已截图（${view.width ?? 0}×${view.height ?? 0}）。` }],
					details: { shot: { path: shotPath, width: view.width ?? 0, height: view.height ?? 0 } },
				};
			}

			const text = formatBrowserControlResult(result);
			return { content: [{ type: "text" as const, text }], details: {} };
		},
	});
}
