import type {
	BrowserControlRequest,
	BrowserControlResult,
	BrowserControlTabInfo,
	SidePaneTabSnapshot,
} from "@tcode/shared";
import { isAllowedBrowserUrl, normalizeBrowserUrl } from "@tcode/shared";
import { getPi } from "../api";
import { useSessionsStore } from "../stores/sessions";
import type { WebviewElement } from "../webview";
import { useBrowserControlNoticeStore } from "./browser-control-notice";
import { DESKTOP_FRAME, DESKTOP_SIZE, useBrowserViewportStore, type ViewportFrame } from "./browser-viewport";
import { getBrowserWebview, listBrowserWebviewIds } from "./browser-webviews";
import { openBrowserTab } from "./openers";
import { useSidePaneStore } from "./store";

const READ_TEXT_LIMIT = 12_000;

const OPEN_LOAD_WAIT_MS = 4_000;

const READ_LOAD_WAIT_MS = 2_500;

const READY_WAIT_MS = 700;

const RETRY_AFTER_RELOAD_MS = 1_000;

const aiTabBySession = new Map<string, string>();

function aiTabOf(sessionId: string, tabs: SidePaneTabSnapshot[]): string | null {
	const remembered = aiTabBySession.get(sessionId);
	if (!remembered) return null;
	if (tabs.some((tab) => tab.id === remembered)) return remembered;
	aiTabBySession.delete(sessionId);
	return null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountDiag(tabId: string): string {
	const nodes = [...document.querySelectorAll("webview")] as HTMLElement[];
	const info =
		`pi=${typeof window.pi} webview元素=${nodes.length}` +
		` 已登记=[${listBrowserWebviewIds().join(",")}]` +
		` domTabId=[${nodes.map((n) => n.dataset.browserTabId ?? "?").join(",")}]`;
	return getBrowserWebview(tabId)
		? `；诊断=元素在DOM但guest未就绪｜${info}`
		: `；诊断=元素不在DOM（面板没挂载/未登记）｜${info}`;
}

async function waitForReady(tabId: string, timeoutMs: number): Promise<WebviewElement | null> {
	const deadline = Date.now() + timeoutMs;
	let lastErr = "元素未登记（面板未挂载 / tabId 对不上 / guest 已被卸载）";
	while (Date.now() < deadline) {
		const el = getBrowserWebview(tabId) as WebviewElement | null;
		if (el) {
			try {
				await el.executeJavaScript("1");
				return el;
			} catch (error) {
				lastErr = `元素已登记，但 guest 未就绪（方法抛错，通常是 guest 被摘掉）：${String((error as Error)?.message ?? error)}`;
			}
		}
		await sleep(150);
	}

	{
		const probe = getBrowserWebview(tabId) as HTMLElement | null;
		if (probe) {
			const rect = probe.getBoundingClientRect();
			const cs = getComputedStyle(probe);
			console.error(
				`[browser-bridge] waitForReady 超时 tab=${tabId} → ${lastErr}｜box=${Math.round(rect.width)}x${Math.round(rect.height)} display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity}`,
			);
		} else {
			console.error(
				`[browser-bridge] waitForReady 超时 tab=${tabId} → ${lastErr}｜元素不在 DOM（面板未挂载）`,
			);
		}
	}

	const el = getBrowserWebview(tabId) as WebviewElement | null;
	if (el) {
		try {
			(el as unknown as { reload?: () => void }).reload?.();

			const retryDeadline = Date.now() + RETRY_AFTER_RELOAD_MS;
			while (Date.now() < retryDeadline) {
				try {
					await (getBrowserWebview(tabId) as WebviewElement | null)?.executeJavaScript("1");
					return getBrowserWebview(tabId) as WebviewElement | null;
				} catch {}
				await sleep(150);
			}
		} catch {}
	}
	return null;
}

const LOAD_WAIT_NO_ELEMENT_ROUNDS = 6;

async function waitForLoad(tabId: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	let missingRounds = 0;
	while (Date.now() < deadline) {
		const el = getBrowserWebview(tabId) as WebviewElement | null;
		if (!el) {
			if (++missingRounds >= LOAD_WAIT_NO_ELEMENT_ROUNDS) return false;
		} else {
			missingRounds = 0;
			try {
				if (el.getURL() !== "about:blank" && !el.isLoading()) return true;
			} catch {}
		}
		await sleep(150);
	}
	return false;
}

function sameUrl(a: string, b: string): boolean {
	return a.replace(/[/?#]+$/, "") === b.replace(/[/?#]+$/, "");
}

function urlLabel(url: string): string {
	return url.replace(/^https?:\/\//, "");
}

function tabCurrentUrl(tab: SidePaneTabSnapshot): string {
	let url = tab.payload.url ?? "";
	try {
		url = (getBrowserWebview(tab.id) as WebviewElement | null)?.getURL() ?? url;
	} catch {}
	return url;
}

function pickTarget(
	sessionId: string,
	owner: { activeTabId: string | null },
	tabs: SidePaneTabSnapshot[],
	requestTabId: string | undefined,
): SidePaneTabSnapshot | null {
	if (requestTabId) return tabs.find((tab) => tab.id === requestTabId) ?? null;
	const aiTabId = aiTabOf(sessionId, tabs);
	if (aiTabId) return tabs.find((tab) => tab.id === aiTabId) ?? null;
	const active = tabs.find((tab) => tab.id === owner.activeTabId);
	if (active) return active;
	return [...tabs].sort((a, b) => a.openedAt - b.openedAt).at(-1) ?? null;
}

function focusIfCurrentSession(sessionId: string, tabId: string): void {
	const state = useSidePaneStore.getState();
	if (state.sessionId !== sessionId) return;
	state.focusBrowserTab(tabId);
}

let unsubscribe: (() => void) | null = null;
let unsubscribeEvents: (() => void) | null = null;

const LEASE_FAILSAFE_MS = 300_000;

interface FrameLease {
	sessionId: string;

	frame: ViewportFrame;

	aiChangedFrame: boolean;
}

const aiFrameLease = new Map<string, FrameLease>();
let leaseFailsafe: number | null = null;

function armLeaseFailsafe(): void {
	if (leaseFailsafe !== null) window.clearTimeout(leaseFailsafe);
	leaseFailsafe = window.setTimeout(() => {
		leaseFailsafe = null;
		for (const lease of [...aiFrameLease.values()]) releaseSessionFrames(lease.sessionId);
	}, LEASE_FAILSAFE_MS);
}

function acquireDesktopFrame(tabId: string, sessionId: string): void {
	const store = useBrowserViewportStore.getState();
	if (!aiFrameLease.has(tabId)) {
		aiFrameLease.set(tabId, { sessionId, frame: store.frames[tabId] ?? "auto", aiChangedFrame: false });
	}
	store.setMode(tabId, "manual");
	store.setFrame(tabId, DESKTOP_FRAME);
	armLeaseFailsafe();
}

function markAiFrameChange(tabId: string): void {
	const lease = aiFrameLease.get(tabId);
	if (lease) lease.aiChangedFrame = true;
}

function releaseSessionFrames(sessionId: string): void {
	const store = useBrowserViewportStore.getState();
	for (const [tabId, lease] of [...aiFrameLease]) {
		if (lease.sessionId !== sessionId) continue;
		aiFrameLease.delete(tabId);
		if (lease.aiChangedFrame) continue;

		if (store.frames[tabId] !== DESKTOP_FRAME) continue;
		store.setFrame(tabId, lease.frame);
	}
	if (aiFrameLease.size === 0 && leaseFailsafe !== null) {
		window.clearTimeout(leaseFailsafe);
		leaseFailsafe = null;
	}
}

export function initBrowserControlBridge(): () => void {
	unsubscribe?.();
	unsubscribe = getPi().onBrowserControlRequest((request) => {
		void handleRequest(request);
	});
	unsubscribeEvents?.();
	unsubscribeEvents = getPi().onEvent(({ sessionId, event }) => {
		if (event.type === "agent_settled") releaseSessionFrames(sessionId);
	});
	return () => {
		unsubscribe?.();
		unsubscribe = null;
		unsubscribeEvents?.();
		unsubscribeEvents = null;
	};
}

export function resetBrowserViewport(tabId: string): { ok: boolean; error?: string } {
	useBrowserViewportStore.getState().clearOverride(tabId);
	return { ok: true };
}

export function setDesktopViewport(tabId: string): { ok: boolean; error?: string } {
	const store = useBrowserViewportStore.getState();
	store.setMode(tabId, "manual");
	store.clearOverride(tabId);
	store.setFrame(tabId, DESKTOP_FRAME);
	return { ok: true };
}

export async function clearGuestViewportEmulation(tabId: string): Promise<void> {
	const el = getBrowserWebview(tabId) as WebviewElement | null;
	if (!el) return;

	try {
		await guestCall(el, "resize", { reset: true });
	} catch {}
}

export function setBrowserViewport(
	tabId: string,
	size: { width: number; height: number },
): { ok: boolean; error?: string } {
	if (!(size.width > 0) || !(size.height > 0)) return { ok: false, error: "容器宽高要大于 0" };
	const mpt = useBrowserViewportStore.getState();
	mpt.setMode(tabId, "manual");

	mpt.setFrame(tabId, DESKTOP_FRAME);
	mpt.setOverride(tabId, { width: size.width, height: size.height, source: "user" });
	void clearGuestViewportEmulation(tabId);
	return { ok: true };
}

async function handleRequest(request: BrowserControlRequest): Promise<void> {
	let result: BrowserControlResult;
	try {
		result = await runOp(request);
	} catch (error) {
		result = { ok: false, error: String((error as Error)?.message ?? error) };
	}
	await getPi()
		.respondBrowserControl({ id: request.id, result })
		.catch(() => {});
}

function hasLocalBrowserTarget(tabs: SidePaneTabSnapshot[]): boolean {
	if (tabs.some((tab) => getBrowserWebview(tab.id))) return true;

	return tabs.length === 0;
}

async function runOp(request: BrowserControlRequest): Promise<BrowserControlResult> {
	const { sessionId } = request;
	if (!sessionId) {
		return {
			ok: false,
			error: "浏览器控制请求没有带会话归属（main 侧未给出 sessionId）：已拒绝，避免落到当前会话的侧栏上",
		};
	}
	const state0 = useSidePaneStore.getState();
	let owner = state0.owners.find((entry) => entry.sessionId === sessionId) ?? null;
	if (!owner) {
		const cwd = useSessionsStore.getState().sessions.find((s) => s.sessionId === sessionId)?.cwd ?? "";
		useSidePaneStore.getState().ensureOwner(cwd, sessionId);
		owner = useSidePaneStore.getState().owners.find((entry) => entry.sessionId === sessionId) ?? null;
	}
	if (!owner) {
		return {
			ok: false,
			error: "这个会话在桌面端侧栏还没有记录：请先在桌面端切到这个会话一次（侧边浏览器按会话窗口记忆）",
		};
	}
	const tabs = owner.tabs.filter((tab) => tab.kind === "browser");

	if (request.op === "list") {
		const aiTabId = aiTabOf(sessionId, tabs);
		return {
			ok: true,
			kind: "tabs",
			tabs: tabs.map((tab) => {
				let url = tab.payload.url ?? "";
				try {
					url = (getBrowserWebview(tab.id) as WebviewElement | null)?.getURL() ?? url;
				} catch {}
				return {
					id: tab.id,
					title: tab.title,
					url,
					current: tab.id === aiTabId,
					active: tab.id === owner.activeTabId,
				} satisfies BrowserControlTabInfo;
			}),
		};
	}

	if (!hasLocalBrowserTarget(tabs)) {
		return { ok: false, error: "no-local-browser: 该 tab 不在本窗口的侧边栏（由其它承载方处理）" };
	}

	if (request.op === "open") {
		const target = normalizeBrowserUrl(request.url ?? "");

		if (!isAllowedBrowserUrl(target) || (!/^https?:\/\//i.test(target) && !/^file:\/\//i.test(target)))
			return { ok: false, error: "只支持 http/https/file 地址" };

		let reuse: SidePaneTabSnapshot | null = request.tabId
			? (tabs.find((tab) => tab.id === request.tabId) ?? null)
			: null;

		if (!reuse) reuse = tabs.find((tab) => sameUrl(tabCurrentUrl(tab), target)) ?? null;
		if (!reuse && !request.newTab) {
			const aiTabId = aiTabOf(sessionId, tabs);
			reuse = aiTabId ? (tabs.find((tab) => tab.id === aiTabId) ?? null) : null;
		}
		if (reuse) {
			const el = await waitForReady(reuse.id, READY_WAIT_MS);
			if (!el)
				return {
					ok: false,
					error: `该 tab 的浏览器实例还没挂载（可能刚打开，稍后重试）${mountDiag(reuse.id)}`,
				};
			aiTabBySession.set(sessionId, reuse.id);
			focusIfCurrentSession(sessionId, reuse.id);
			const notice = useBrowserControlNoticeStore.getState();
			notice.show(reuse.id, "act", request.op);
			try {
				let currentUrl = "";
				try {
					currentUrl = el.getURL();
				} catch {}
				if (sameUrl(currentUrl, target)) {
					const loaded = await waitForLoad(reuse.id, OPEN_LOAD_WAIT_MS);
					return { ok: true, kind: "opened", tabId: reuse.id, url: target, loaded };
				}
				await el.loadURL(target).catch(() => {});

				useSidePaneStore.getState().setTabTitle(reuse.id, urlLabel(target));
				const loaded = await waitForLoad(reuse.id, OPEN_LOAD_WAIT_MS);
				return { ok: true, kind: "opened", tabId: reuse.id, url: target, loaded };
			} finally {
				notice.markDone(reuse.id);
			}
		}
		const tabId = openBrowserTab(target, sessionId);

		const created = useSidePaneStore
			.getState()
			.owners.find((entry) => entry.sessionId === sessionId)
			?.tabs.some((tab) => tab.id === tabId);
		if (!created) {
			return {
				ok: false,
				error: "这个会话在桌面端侧栏还没有记录：请先在桌面端切到这个会话一次（侧边浏览器按会话窗口记忆）",
			};
		}
		aiTabBySession.set(sessionId, tabId);
		const notice = useBrowserControlNoticeStore.getState();
		notice.show(tabId, "act", request.op);
		try {
			const loaded = await waitForLoad(tabId, OPEN_LOAD_WAIT_MS);
			return { ok: true, kind: "opened", tabId, url: target, loaded };
		} finally {
			notice.markDone(tabId);
		}
	}

	const target = pickTarget(sessionId, owner, tabs, request.tabId);
	if (!target) {
		return {
			ok: false,
			error:
				tabs.length === 0
					? "本会话还没有侧边浏览器 tab（可用 open 先打开一个网址）"
					: `找不到 tab ${request.tabId}`,
		};
	}
	const el = await waitForReady(target.id, READY_WAIT_MS);
	if (!el)
		return { ok: false, error: `该 tab 的浏览器实例还没挂载（可能刚打开，稍后重试）${mountDiag(target.id)}` };
	aiTabBySession.set(sessionId, target.id);

	acquireDesktopFrame(target.id, sessionId);
	const notice = useBrowserControlNoticeStore.getState();

	notice.show(target.id, request.op === "read" ? "view" : "act", request.op);
	try {
		const guest = await runGuestOp(request, el, target.id);
		if (guest) return guest;

		if (request.op === "reload") {
			el.reload();

			await sleep(50);
			const loaded = await waitForLoad(target.id, OPEN_LOAD_WAIT_MS);
			return {
				ok: true,
				kind: "reloaded",
				tabId: target.id,
				url: tabCurrentUrl(target),
				title: el.getTitle() || target.title,
				loaded,
			};
		}

		if (request.op === "close") {
			const store = useSidePaneStore.getState();
			if (typeof store.closeTab !== "function")
				return { ok: false, error: "侧边栏不支持关闭标签（缺少 closeTab）" };
			const closing = request.all === true ? tabs.map((tab) => tab.id) : [target.id];
			for (const id of closing) store.closeTab(id);

			for (const id of closing) useBrowserViewportStore.getState().clearOverride(id);
			if (request.all === true) aiTabBySession.delete(sessionId);
			return {
				ok: true,
				kind: "acted",
				tabId: target.id,
				action: "close",
				detail: `已关闭 ${closing.length} 个标签`,
				truncated: false,
			};
		}

		if (request.op === "click" || request.op === "type") {
			if (!request.selector) return { ok: false, error: `${request.op} 需要 selector` };
			if (request.op === "type" && typeof request.text !== "string") {
				return { ok: false, error: "type 需要 text" };
			}
			const index = request.index ?? 0;
			const probe = await probeTarget(el, request.selector, index);
			if (probe.kind === "missing") return { ok: false, error: probe.detail };

			if (await moveCursorToPoint(el, probe, request.op === "click")) {
				await sleep(CURSOR_FLIGHT_MS);
			}

			if (request.op === "click") {
				if (!probe.hittable) {
					return {
						ok: false,
						error: `点不到 ${probe.label}：中心点被 ${probe.covering} 盖住（元素不在可点区域或已被遮挡）。换个能点到的元素，或用 keys（Tab 到它再回车）；不要改用 script 绕过——用户看不到，等于没操作`,
					};
				}
				const hostActive =
					typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
				const hostHadFocus = typeof document !== "undefined" && document.hasFocus();
				const out = await guestCall(el, "click", { x: probe.x, y: probe.y });
				if (hostHadFocus && hostActive && hostActive !== document.body && hostActive.isConnected) {
					hostActive.focus();
				}
				if (!out.ok) return { ok: false, error: `真实鼠标点击失败：${out.error}` };
				return {
					ok: true,
					kind: "acted",
					tabId: target.id,
					action: "click",
					detail: `已点击 ${probe.label}（真实鼠标 ${probe.x},${probe.y}）`,
					truncated: false,
				};
			}

			const prep = (await el.executeJavaScript(prepareTypeScript(request.selector, index))) as
				| { kind?: TypeTargetKind; focused?: boolean }
				| undefined;
			const text = request.text ?? "";
			if (!isTextEntry(prep?.kind)) {
				return {
					ok: false,
					error:
						prep?.kind === "select"
							? `${probe.label} 是 select：没有文本输入语义。先 click 聚焦它，再用 keys（ArrowDown / Enter）选`
							: `${probe.label} 不是输入框（input / textarea / contenteditable 才能填）`,
				};
			}
			if (prep?.focused !== true) {
				return { ok: false, error: `${probe.label} 聚焦不了（disabled / readonly / 已从文档移除？）` };
			}
			const out = await guestCall(el, "type", { text, submit: request.submit === true });
			if (!out.ok) return { ok: false, error: `真实文本输入失败：${out.error}` };

			if (text.length > 0 && !(await typeLanded(el, request.selector, index))) {
				return { ok: false, error: `文本没有写进 ${probe.label}（站点可能拦下了这次输入）` };
			}
			return {
				ok: true,
				kind: "acted",
				tabId: target.id,
				action: "type",
				detail: `已填入 ${probe.label}：${text.slice(0, 80)}${request.submit === true ? "（并按了 Enter）" : ""}`,
				truncated: false,
			};
		}
		if (request.op === "script") {
			if (!request.code) return { ok: false, error: "script 需要 code" };
			const raw = (await el.executeJavaScript(scriptWrap(request.code))) as
				| { text?: string; truncated?: boolean; error?: string }
				| undefined;
			if (!raw || raw.error) return { ok: false, error: raw?.error ?? "页面没有返回结果" };
			return {
				ok: true,
				kind: "acted",
				tabId: target.id,
				action: "script",
				detail: raw.text ?? "",
				truncated: raw.truncated === true,
			};
		}

		await waitForLoad(target.id, READ_LOAD_WAIT_MS);
		const raw = (await el.executeJavaScript(readScript(request.selector, request.format))) as
			| { title?: string; url?: string; text?: string; truncated?: boolean; error?: string }
			| undefined;
		if (!raw || raw.error) return { ok: false, error: raw?.error ?? "页面没有返回内容" };
		return {
			ok: true,
			kind: "page",
			url: raw.url ?? "",
			title: raw.title ?? "",
			text: raw.text ?? "",
			truncated: raw.truncated === true,
		};
	} finally {
		notice.markDone(target.id);
	}
}

const CURSOR_FLIGHT_MS = 360;

const CURSOR_EASE = "cubic-bezier(.22,.61,.36,1)";

export const CURSOR_HIDE_AFTER_MS = 5_000;
const CURSOR_JS = `(() => {
	const ID = "__tcode_cursor";
	const cached = window.__tcodeCursor;
	if (cached && cached.root && cached.root.isConnected) return cached;
	const FLIGHT = ${CURSOR_FLIGHT_MS};
	const HIDE_AFTER = ${CURSOR_HIDE_AFTER_MS};
	const EASE = ${JSON.stringify(CURSOR_EASE)};
	let root = document.getElementById(ID);
	if (root && !(root.__tcodeArrow && root.__tcodeRing)) {
		root.remove();
		root = null;
	}
	if (!root) {
		root = document.createElement("div");
		root.id = ID;
		root.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:opacity .25s ease;";
		const arrow = document.createElement("div");
		arrow.style.cssText = "position:fixed;width:25px;height:25px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3));transition:left " + FLIGHT + "ms " + EASE + ",top " + FLIGHT + "ms " + EASE + ";";
		arrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 100 100" style="display:block"><path d="M13.86 6.58 L13.69 6.75 L13.55 7.01 L13.42 7.35 L13.32 7.79 L13.24 8.32 L13.17 8.94 L13.13 9.65 L13.11 10.44 L13.11 11.33 L13.19 13.17 L13.36 15.94 L13.61 19.67 L13.94 24.33 L14.36 29.94 L14.86 36.50 L15.44 44.00 L16.11 52.44 L16.71 59.97 L17.24 66.58 L17.69 72.28 L18.08 77.06 L18.40 80.92 L18.65 83.86 L18.83 85.89 L18.94 87.00 L19.09 88.02 L19.27 88.95 L19.49 89.79 L19.74 90.54 L20.02 91.20 L20.34 91.77 L20.69 92.25 L21.08 92.64 L21.47 92.96 L21.86 93.21 L22.25 93.39 L22.64 93.50 L23.03 93.54 L23.42 93.51 L23.81 93.42 L24.19 93.25 L24.78 92.70 L25.58 91.77 L26.57 90.46 L27.76 88.76 L29.16 86.69 L30.76 84.23 L32.56 81.39 L34.56 78.17 L36.38 75.27 L38.03 72.70 L39.51 70.46 L40.82 68.54 L41.95 66.95 L42.91 65.69 L43.69 64.75 L44.31 64.14 L44.98 63.56 L45.72 63.02 L46.51 62.51 L47.38 62.04 L48.30 61.60 L49.28 61.20 L50.33 60.83 L51.44 60.50 L52.89 60.19 L54.67 59.92 L56.78 59.67 L59.22 59.44 L62.00 59.25 L65.11 59.08 L68.56 58.94 L72.33 58.83 L75.66 58.66 L78.53 58.42 L80.96 58.13 L82.93 57.76 L84.45 57.34 L85.52 56.85 L86.14 56.31 L86.31 55.69 L85.40 54.43 L83.43 52.51 L80.39 49.94 L76.28 46.72 L71.10 42.85 L64.85 38.32 L57.53 33.14 L49.14 27.31 L41.73 22.19 L35.30 17.78 L29.85 14.10 L25.38 11.13 L21.88 8.87 L19.37 7.33 L17.83 6.50 L17.28 6.39 L16.72 6.31 L16.15 6.27 L15.57 6.26 L14.99 6.29 L14.51 6.35 L14.13 6.45 L13.86 6.58 Z" fill="#111111" stroke="#ffffff" stroke-width="12" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"/></svg>';
		const ring = document.createElement("div");
		ring.style.cssText = "position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:2px solid rgba(59,130,246,.9);opacity:0;transition:left " + FLIGHT + "ms " + EASE + ",top " + FLIGHT + "ms " + EASE + ";";
		root.appendChild(arrow);
		root.appendChild(ring);
		(document.body || document.documentElement).appendChild(root);
		const cx = Math.round(window.innerWidth / 2);
		const cy = Math.round(window.innerHeight / 2);
		arrow.style.left = (cx - 3.6) + "px";
		arrow.style.top = (cy - 1.5) + "px";
		ring.style.left = cx + "px";
		ring.style.top = cy + "px";
		void arrow.offsetWidth;
		void ring.offsetWidth;
		root.__tcodeArrow = arrow;
		root.__tcodeRing = ring;
	}
	const arrow = root.__tcodeArrow;
	const ring = root.__tcodeRing;
	const OX = 3.6;
	const OY = 1.5;
	window.__tcodeCursor = {
		root,
		arrow,
		ring,
		move(x, y, click) {
			arrow.style.left = (x - OX) + "px";
			arrow.style.top = (y - OY) + "px";
			ring.style.left = x + "px";
			ring.style.top = y + "px";
			root.style.opacity = "1";
			const self = window.__tcodeCursor;
			if (self) {
				if (self.hideTimer) clearTimeout(self.hideTimer);
				self.hideTimer = setTimeout(() => {
					self.hideTimer = 0;
					root.style.opacity = "0";
				}, HIDE_AFTER);
			}
			if (click) {
				setTimeout(() => {
					try {
						ring.animate([{ transform: "scale(1)", opacity: 0.9 }, { transform: "scale(3.5)", opacity: 0 }], { duration: 420, easing: "ease-out" });
						arrow.animate([{ transform: "scale(1)" }, { transform: "scale(0.82)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
					} catch (e) {}
				}, FLIGHT);
			}
		},
	};
	return window.__tcodeCursor;
})()`;

function cursorMoveJs(x: number, y: number, click: boolean): string {
	return `${CURSOR_JS};
(() => { window.__tcodeCursor.move(${x}, ${y}, ${click ? "true" : "false"}); })()`;
}

function cursorToCenterJs(): string {
	return `${CURSOR_JS};
(() => { window.__tcodeCursor.move(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2), false); })()`;
}

function cursorOnFocusJs(): string {
	return `${CURSOR_JS};
(() => { const n = document.activeElement; if (!n) return; const b = n.getBoundingClientRect(); window.__tcodeCursor.move(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2), true); })()`;
}

type TargetProbe =
	| { kind: "missing"; detail: string }
	| { kind: "ok"; x: number; y: number; label: string; hittable: boolean; covering: string };

async function probeTarget(el: WebviewElement, selector: string, index: number): Promise<TargetProbe> {
	try {
		const res = (await el.executeJavaScript(
			`(() => {
	const nodes = document.querySelectorAll(${JSON.stringify(selector)});
	const n = nodes[${index}];
	if (!n) {
		return { missing: nodes.length === 0 ? "选择器没有匹配到任何元素" : "只命中 " + nodes.length + " 个元素，没有第 ${index + 1} 个" };
	}
	n.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
	const b = n.getBoundingClientRect();
	const label = String(n.innerText || n.getAttribute("aria-label") || n.value || "").trim().replace(/\\s+/g, " ").slice(0, 60);
	const at = (fx, fy) => ({ x: Math.round(b.left + b.width * fx), y: Math.round(b.top + b.height * fy) });
	const points = [at(0.5, 0.5), at(0.25, 0.5), at(0.75, 0.5), at(0.5, 0.25), at(0.5, 0.75)];
	const describe = (hit) => {
		if (!hit) return "视口外";
		const classes = typeof hit.className === "string" ? hit.className.trim().split(/\\s+/).slice(0, 3).join(".") : "";
		return hit.tagName.toLowerCase() + (classes ? "." + classes : "");
	};
	let chosen = null;
	let centerHit = null;
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		const hit = document.elementFromPoint(p.x, p.y);
		if (i === 0) centerHit = hit;
		if (hit && (hit === n || n.contains(hit))) { chosen = p; break; }
	}
	const point = chosen || points[0];
	return {
		x: point.x,
		y: point.y,
		label: "<" + n.tagName.toLowerCase() + ">" + (label ? "「" + label + "」" : ""),
		hittable: !!chosen,
		covering: describe(centerHit),
	};
})()`,
		)) as {
			missing?: string;
			x?: number;
			y?: number;
			label?: string;
			hittable?: boolean;
			covering?: string;
		} | null;
		if (res?.missing) return { kind: "missing", detail: res.missing };
		if (res && typeof res.x === "number" && typeof res.y === "number") {
			return {
				kind: "ok",
				x: res.x,
				y: res.y,
				label: res.label ?? "",
				hittable: res.hittable === true,
				covering: res.covering ?? "未知元素",
			};
		}
	} catch {}
	return { kind: "missing", detail: "页面探测失败（页面可能还在加载）" };
}

async function moveCursorToPoint(el: WebviewElement, probe: TargetProbe, click: boolean): Promise<boolean> {
	if (probe.kind !== "ok") return false;
	try {
		await el.executeJavaScript(cursorMoveJs(probe.x, probe.y, click));
		return true;
	} catch {
		return false;
	}
}

type TypeTargetKind = "input" | "textarea" | "editable" | "select" | "other";

function isTextEntry(kind: TypeTargetKind | undefined): boolean {
	return kind === "input" || kind === "textarea" || kind === "editable";
}

function prepareTypeScript(selector: string, index: number): string {
	return `(() => {
try {
	const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
	const node = nodes[${index}];
	if (!node) return { kind: "other", focused: false };
	let kind = "other";
	if (node.isContentEditable) kind = "editable";
	else if (node instanceof HTMLTextAreaElement) kind = "textarea";
	else if (node instanceof HTMLInputElement) kind = "input";
	else if (node instanceof HTMLSelectElement) kind = "select";
	node.focus();
	const active = document.activeElement;
	const focused = !!active && (active === node || node.contains(active));
	if (focused && (kind === "input" || kind === "textarea" || kind === "editable")) {
		try {
			if (typeof node.select === "function") node.select();
			else {
				const range = document.createRange();
				range.selectNodeContents(node);
				const sel = window.getSelection();
				if (sel) { sel.removeAllRanges(); sel.addRange(range); }
			}
			} catch (e) {}
	}
	return { kind, focused };
} catch (error) {
	return { kind: "other", focused: false, error: String((error && error.message) || error) };
}
})()`;
}

function typeLandedScript(selector: string, index: number): string {
	return `(() => {
const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
if (!node) return false;
const value = node.isContentEditable ? node.textContent || "" : typeof node.value === "string" ? node.value : "";
return value.trim().length > 0;
})()`;
}

async function typeLanded(el: WebviewElement, selector: string, index: number): Promise<boolean> {
	try {
		return (await el.executeJavaScript(typeLandedScript(selector, index))) === true;
	} catch {
		return false;
	}
}

function guestCall(el: WebviewElement, method: string, params: Record<string, unknown>) {
	const webContentsId = (el as unknown as { getWebContentsId(): number }).getWebContentsId();
	return getPi().invokeBrowserGuest({ webContentsId, method, params });
}

function scriptWrap(code: string): string {
	return `(async () => {
try {
	const value = await (async () => {
${code}
	})();
	let text;
	if (typeof value === "string") text = value;
	else if (value === undefined) text = "undefined";
	else {
		try { text = JSON.stringify(value); } catch (_) { text = String(value); }
	}
	if (typeof text !== "string") text = String(text);
	return { text: text.slice(0, ${READ_TEXT_LIMIT}), truncated: text.length > ${READ_TEXT_LIMIT} };
} catch (error) {
	return { error: String((error && error.message) || error) };
}
})()`;
}

function readScript(selector: string | undefined, format: "text" | "html" | undefined): string {
	const root = selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.body";
	const value = format === "html" ? "root.innerHTML" : '(root.innerText || root.textContent || "")';
	return `(() => {
try {
	const root = ${root};
	if (!root) return { error: "页面里没有匹配到目标元素（选择器未命中，或页面还在加载）" };
	const text = String(${value}).replace(/\\u00a0/g, " ").trim();
	return {
		title: document.title,
		url: location.href,
		text: text.slice(0, ${READ_TEXT_LIMIT}),
		truncated: text.length > ${READ_TEXT_LIMIT},
	};
} catch (error) {
	return { error: String((error && error.message) || error) };
}
})()`;
}

async function runGuestOp(
	request: BrowserControlRequest,
	el: WebviewElement,
	targetId: string,
): Promise<BrowserControlResult | null> {
	const call = (method: string, params: Record<string, unknown>) => guestCall(el, method, params);
	if (request.op === "keys") {
		if (!request.key) return { ok: false, error: "keys 需要 key（Escape / Tab / ArrowDown / a）" };

		await el.executeJavaScript(cursorOnFocusJs()).catch(() => {});
		const out = await call("keys", { key: request.key, modifiers: request.modifiers });
		if (!out.ok) return { ok: false, error: out.error };
		const sent = out.result as { keyCode?: string } | undefined;
		return {
			ok: true,
			kind: "acted",
			tabId: targetId,
			action: "keys",
			detail: `已发送 ${request.key}（keyCode=${sent?.keyCode ?? request.key}）`,
			truncated: false,
		};
	}
	if (request.op === "resize") {
		const reset = request.reset === true;
		if (!reset && (!request.width || !request.height))
			return { ok: false, error: "resize 需要 width/height，或 reset:true" };

		const viewport = useBrowserViewportStore.getState();
		if (reset) {
			viewport.clearOverride(targetId);
			return {
				ok: true,
				kind: "resized",
				tabId: targetId,
				width: DESKTOP_SIZE.width,
				height: DESKTOP_SIZE.height,
				reset,
			};
		}

		viewport.setMode(targetId, "manual");

		viewport.setFrame(targetId, DESKTOP_FRAME);

		markAiFrameChange(targetId);
		viewport.setOverride(targetId, {
			width: request.width ?? 0,
			height: request.height ?? 0,
			source: "ai",
		});

		void clearGuestViewportEmulation(targetId);
		return {
			ok: true,
			kind: "resized",
			tabId: targetId,
			width: request.width ?? 0,
			height: request.height ?? 0,
			reset,
		};
	}
	if (request.op === "cdp") {
		if (!request.method) return { ok: false, error: "cdp 需要 method" };
		const out = await call("cdp", { method: request.method, params: request.params });
		if (!out.ok) return { ok: false, error: out.error };
		return {
			ok: true,
			kind: "cdp",
			tabId: targetId,
			method: request.method,
			result: JSON.stringify(out.result ?? null).slice(0, 4000),
		};
	}
	if (request.op === "console") {
		const out = await call("console", { clear: request.clear === true });
		if (!out.ok) return { ok: false, error: out.error };
		const all = (out.result as { logs?: { level: string; text: string }[] } | undefined)?.logs ?? [];
		const logs = all.slice(-80);
		return { ok: true, kind: "logs", tabId: targetId, logs, dropped: all.length - logs.length };
	}
	if (request.op === "screenshot") {
		const view = (await el.executeJavaScript("({ w: window.innerWidth, h: window.innerHeight })")) as
			| { w?: number; h?: number }
			| undefined;
		return {
			ok: true,
			kind: "shot",
			tabId: targetId,
			webContentsId: (el as unknown as { getWebContentsId(): number }).getWebContentsId(),
			width: view?.w ?? 0,
			height: view?.h ?? 0,
		};
	}
	if (request.op === "wait") {
		const timeout = Math.max(200, Math.min(60000, request.timeout ?? 8000));

		const networkIdle = `(() => {
			const n = performance.getEntriesByType("resource").length;
			const now = Date.now();
			if (window.__tcodeNetIdleN !== n) { window.__tcodeNetIdleN = n; window.__tcodeNetIdleSince = now; return false; }
			if (typeof window.__tcodeNetIdleSince !== "number") { window.__tcodeNetIdleSince = now; return false; }
			return document.readyState === "complete" && now - window.__tcodeNetIdleSince > 500;
		})()`;
		const cond = request.selector
			? `document.querySelector(${JSON.stringify(request.selector)}) !== null`
			: request.text
				? `document.body.innerText.includes(${JSON.stringify(request.text)})`
				: request.idle === "network"
					? networkIdle
					: `document.readyState === "complete"`;
		const what = request.selector
			? `选择器 ${request.selector}`
			: request.text
				? `文本「${request.text}」`
				: request.idle === "network"
					? "网络空闲"
					: "页面加载完成";

		const script = `(async () => {
	try { delete window.__tcodeNetIdleN; delete window.__tcodeNetIdleSince; } catch (e) {}
	const t0 = Date.now();
	while (Date.now() - t0 < ${timeout}) { try { if (${cond}) return { ok: true }; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); }
	return { ok: false };
})()`;
		const res = (await el.executeJavaScript(script)) as { ok?: boolean } | undefined;
		if (!res?.ok) return { ok: false, error: `等待超时（${timeout}ms）：${what}` };
		return {
			ok: true,
			kind: "acted",
			tabId: targetId,
			action: "wait",
			detail: `已满足：${what}`,
			truncated: false,
		};
	}
	if (request.op === "hover") {
		if (!request.selector) return { ok: false, error: "hover 需要 selector" };

		const probe = await probeTarget(el, request.selector, request.index ?? 0);
		if (probe.kind !== "ok") return { ok: false, error: probe.detail };

		if (await moveCursorToPoint(el, probe, false)) await sleep(CURSOR_FLIGHT_MS);

		const out = await call("cdp", {
			method: "Input.dispatchMouseEvent",
			params: { type: "mouseMoved", x: probe.x, y: probe.y, button: "none" },
		});
		if (!out.ok) return { ok: false, error: out.error };
		return {
			ok: true,
			kind: "acted",
			tabId: targetId,
			action: "hover",
			detail: `已移动到 ${probe.label}（真实鼠标 ${probe.x},${probe.y}）`,
			truncated: false,
		};
	}
	if (request.op === "scroll") {
		const script = `(() => { window.scrollBy({ left: ${request.dx ?? 0}, top: ${request.dy ?? 0}, behavior: ${JSON.stringify(request.behavior ?? "auto")} }); return { x: window.scrollX, y: window.scrollY }; })()`;
		const res = (await el.executeJavaScript(script)) as { x?: number; y?: number } | undefined;

		await el.executeJavaScript(cursorToCenterJs()).catch(() => {});
		return {
			ok: true,
			kind: "acted",
			tabId: targetId,
			action: "scroll",
			detail: `已滚动到 (${res?.x ?? 0}, ${res?.y ?? 0})`,
			truncated: false,
		};
	}
	return null;
}
