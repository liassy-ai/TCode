import { type WebContents, webContents } from "electron";

export type GuestInvokePayload = { webContentsId: number; method: string; params?: Record<string, unknown> };
export type GuestInvokeResult = { ok: true; result?: unknown } | { ok: false; error: string };

type LogEntry = { level: string; text: string };

const consoleBuffers = new Map<number, LogEntry[]>();
const taps = new Set<number>();

const KEY_ALIAS: Record<string, string> = {
	Escape: "Esc",
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
	Enter: "Enter",
	" ": "Space",
	Backspace: "Backspace",
	Delete: "Delete",
	Tab: "Tab",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
};
const MOD_ALIAS: Record<string, "control" | "shift" | "alt" | "meta"> = {
	ctrl: "control",
	control: "control",
	alt: "alt",
	shift: "shift",
	meta: "meta",
	cmd: "meta",
};

function guestOf(id: number): WebContents | null {
	const wc = webContents.fromId(id);
	if (!wc || wc.isDestroyed()) return null;
	return wc;
}

function ensureAttached(wc: WebContents): { ok: true } | { ok: false; error: string } {
	try {
		if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
	} catch (error) {
		return {
			ok: false,
			error: `无法附加到该页面（可能已手动打开 DevTools，或页面正在销毁）：${String(error)}`,
		};
	}
	if (!taps.has(wc.id)) {
		const buf: LogEntry[] = [];
		consoleBuffers.set(wc.id, buf);
		taps.add(wc.id);
		wc.debugger.on("message", (_event, method, params) => {
			if (method !== "Runtime.consoleAPICalled") return;
			const p = params as { type?: string; args?: { value?: unknown; description?: string }[] };
			const text = (p.args ?? [])
				.map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? "")))
				.join(" ");
			buf.push({ level: String(p.type ?? "log"), text });
			if (buf.length > 300) buf.splice(0, buf.length - 300);
		});
		wc.debugger.on("detach", () => {
			taps.delete(wc.id);
			consoleBuffers.delete(wc.id);
		});
		try {
			void wc.debugger.sendCommand("Runtime.enable");
		} catch {}
	}
	return { ok: true };
}

export function primeGuest(contents: WebContents): void {
	if (contents.isDestroyed()) return;
	ensureAttached(contents);
}

function pressEnter(wc: WebContents): void {
	wc.sendInputEvent({ type: "char", keyCode: "\r" });
}

export async function invokeGuest({
	webContentsId,
	method,
	params,
}: GuestInvokePayload): Promise<GuestInvokeResult> {
	const wc = guestOf(webContentsId);
	if (!wc) return { ok: false, error: "目标 webview 不可用（可能已关闭或正在销毁）" };

	switch (method) {
		case "keys": {
			const key = String(params?.key ?? "");
			if (!key) return { ok: false, error: "keys 需要 key（如 Escape / Tab / ArrowDown / a）" };
			const keyCode = KEY_ALIAS[key] ?? key;
			const modifiers = ((params?.modifiers as string[] | undefined) ?? [])
				.map((m) => MOD_ALIAS[m])
				.filter((m): m is "control" | "shift" | "alt" | "meta" => Boolean(m));
			wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
			wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
			return { ok: true, result: { sent: key, keyCode, modifiers } };
		}
		case "click": {
			const attached = ensureAttached(wc);
			if (!attached.ok) return attached;
			const x = Number(params?.x ?? Number.NaN);
			const y = Number(params?.y ?? Number.NaN);
			if (!Number.isFinite(x) || !Number.isFinite(y)) {
				return { ok: false, error: "click 需要 x/y（视口 CSS 像素）" };
			}
			await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x,
				y,
				button: "none",
				buttons: 0,
			});
			await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
				type: "mousePressed",
				x,
				y,
				button: "left",
				buttons: 1,
				clickCount: 1,
			});

			await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				x,
				y,
				button: "left",
				buttons: 0,
				clickCount: 1,
			});
			return { ok: true, result: { x, y } };
		}
		case "type": {
			const text = String(params?.text ?? "");
			if (text) wc.insertText(text);
			const submit = params?.submit === true;
			if (submit) pressEnter(wc);
			return { ok: true, result: { inserted: text.length, submitted: submit } };
		}
		case "resize": {
			const attached = ensureAttached(wc);
			if (!attached.ok) return attached;
			if (params?.reset === true) {
				await wc.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
				return { ok: true, result: { reset: true } };
			}
			const width = Number(params?.width ?? 0);
			const height = Number(params?.height ?? 0);
			if (!width || !height) return { ok: false, error: "resize 需要 width/height，或用 reset:true 清除" };

			const rawScale = Number(params?.scale ?? 1);
			const scale = Number.isFinite(rawScale) && rawScale > 0 ? Math.min(1, rawScale) : 1;
			await wc.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
				width,
				height,
				deviceScaleFactor: 0,
				mobile: false,
				...(scale < 1 ? { scale } : {}),
			});
			return { ok: true, result: { width, height, scale } };
		}
		case "screenshot": {
			const attached = ensureAttached(wc);
			if (!attached.ok) return attached;
			const fullPage = params?.full_page === true;

			let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
			if (fullPage) {
				const metrics = (await wc.debugger.sendCommand("Page.getLayoutMetrics")) as {
					cssContentSize?: { width?: number; height?: number };
				};
				const size = metrics.cssContentSize;
				if (size?.width && size?.height) {
					clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 };
				}
			}
			const shot = (await wc.debugger.sendCommand("Page.captureScreenshot", {
				format: "png",
				fromSurface: true,
				captureBeyondViewport: fullPage,
				...(clip ? { clip } : {}),
			})) as { data?: string };
			return { ok: true, result: { base64: shot.data ?? "", full_page: fullPage } };
		}
		case "console": {
			const attached = ensureAttached(wc);
			if (!attached.ok) return attached;
			const buf = consoleBuffers.get(wc.id) ?? [];
			const logs = buf.slice();
			if (params?.clear === true) buf.length = 0;
			return { ok: true, result: { logs } };
		}
		default: {
			const attached = ensureAttached(wc);
			if (!attached.ok) return attached;
			const cdpMethod = String(params?.method ?? method);
			if (/^Input\.(insertText|dispatchKeyEvent)$/i.test(cdpMethod)) {
				return {
					ok: false,
					error:
						"cdp 不能直接注入键盘事件（会落到窗口当前焦点，可能输入到应用输入框）；请用 type / keys 动作",
				};
			}
			const cdpParams = (params?.params as Record<string, unknown> | undefined) ?? {};

			const call = /^[A-Z][A-Za-z]*\.[A-Z]/.test(cdpMethod)
				? wc.debugger.sendCommand(cdpMethod, cdpParams)
				: null;
			if (!call)
				return {
					ok: false,
					error:
						"未知 method（可用 keys / click / type / resize / screenshot / console，或 CDP 方法名 like Page.captureScreenshot）",
				};
			const result = await call;
			return { ok: true, result };
		}
	}
}
