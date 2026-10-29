import { CHANNEL_TABLE, type InvokeApi, IpcChannels, type PiApi } from "@tcode/shared";
import { randomUid } from "./lib/uid";

declare global {
	interface Window {
		pi?: PiApi;
	}
}

const DEV_BRIDGE_CANDIDATES = [1200, 1201, 1202, 1203, 1204];

let devBridgeBase: string | null = null;

function bridgeToken(): string | null {
	return new URLSearchParams(window.location.search).get("token");
}

function webBasePath(): string {
	if (import.meta.env.DEV || window.pi) return "";
	const parts = window.location.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
	if (!parts.length) return "";

	if (parts[0] === "preview" && parts[1]) return `/preview/${parts[1]}`;
	const seg = parts[0] ?? "";
	if (!seg || seg.includes(".")) return "";
	return `/${seg}`;
}

function bridgeBase(): string {
	const override = new URLSearchParams(window.location.search).get("bridge");
	if (override) return override.replace(/\/+$/, "");

	if (!import.meta.env.DEV) return "";

	return devBridgeBase ?? `${window.location.protocol}//127.0.0.1:1200`;
}

async function probeDevBridge(): Promise<void> {
	if (!import.meta.env.DEV) return;
	const token = bridgeToken();
	for (const port of DEV_BRIDGE_CANDIDATES) {
		const base = `${window.location.protocol}//127.0.0.1:${port}`;
		try {
			const query = token ? `?token=${encodeURIComponent(token)}` : "";
			const res = await fetch(`${base}/api/auth-check${query}`, { credentials: "include" });
			if (res.status === 204 || res.status === 401) {
				devBridgeBase = base.replace(/\/+$/, "");
				return;
			}
		} catch {}
	}
}

function bridgeWsUrl(): string {
	const base = bridgeBase();
	if (base === "") {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		return `${protocol}//${window.location.host}${webBasePath()}/api/ws`;
	}

	const token = bridgeToken();
	const query = token ? `?token=${encodeURIComponent(token)}` : "";
	return `${base.replace(/^http/, "ws")}/api/ws${query}`;
}

function detectPlatform(): PiApi["platform"] {
	if (/Windows/i.test(navigator.userAgent)) return "win32";
	if (/Mac OS X|Macintosh/i.test(navigator.userAgent)) return "darwin";
	return "linux";
}

const FRAME_HEADER_LENGTH = 4;

function createRemotePi(): PiApi {
	const currentBase = () => bridgeBase();

	const pageSessionId = randomUid();
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	let socket: WebSocket | null = null;

	let ready: Promise<void> | null = null;

	const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	let invokeSeq = 0;

	const LOST_AFTER_MS = 70_000;

	const RECONNECT_MS = 1_500;
	let lastFrameAt = Date.now();

	let watchdogArmed = false;

	const frameUrls = new Map<string, string>();

	const deliver = (channel: string, payload: unknown) => {
		for (const cb of listeners.get(channel) ?? []) {
			try {
				cb(payload);
			} catch {}
		}
	};

	const rejectPending = () => {
		for (const [, entry] of pending) entry.reject(new Error("web 桥连接已断开"));
		pending.clear();
	};

	let checkingAuth = false;
	const checkAuthThenMaybeReload = () => {
		if (currentBase() !== "" || checkingAuth) return;
		checkingAuth = true;
		fetch(`${webBasePath()}/api/auth-check`, { cache: "no-store" })
			.then((res) => {
				if (res.status === 401) location.reload();
			})
			.catch(() => {})
			.finally(() => {
				checkingAuth = false;
			});
	};

	const deliverFrame = async (data: ArrayBuffer | Blob) => {
		const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
		const bytes = new Uint8Array(buffer);

		let end = -1;
		for (let i = FRAME_HEADER_LENGTH; i < Math.min(bytes.length, 64); i++) {
			if (bytes[i] === 0x0a) {
				end = i;
				break;
			}
		}
		if (end < 0 || String.fromCharCode(...bytes.subarray(0, FRAME_HEADER_LENGTH)) !== "PF1 ") return;
		const id = new TextDecoder().decode(bytes.subarray(FRAME_HEADER_LENGTH, end));
		const url = URL.createObjectURL(new Blob([bytes.subarray(end + 1)], { type: "image/jpeg" }));
		const previous = frameUrls.get(id);
		if (previous) setTimeout(() => URL.revokeObjectURL(previous), 1_000);
		frameUrls.set(id, url);
		deliver(IpcChannels.RemoteBrowserFrame, { id, dataUrl: url });
	};

	const openSocket = () => {
		const ws = new WebSocket(bridgeWsUrl());
		ws.binaryType = "arraybuffer";
		socket = ws;
		ready = new Promise<void>((resolve, reject) => {
			ws.onopen = () => {
				lastFrameAt = Date.now();

				ws.send(JSON.stringify({ kind: "hello", session: pageSessionId }));
				resolve();
			};

			ws.onerror = () =>
				reject(
					new Error(`web 桥不可达（${currentBase() || window.location.origin}）：桌面端需在运行且端口可用`),
				);
		});
		ready.catch(() => {});
		ws.onmessage = (event) => {
			lastFrameAt = Date.now();
			if (typeof event.data !== "string") {
				void deliverFrame(event.data as ArrayBuffer | Blob);
				return;
			}
			let message: {
				kind?: string;
				id?: number;
				channel?: string;
				ok?: boolean;
				result?: unknown;
				error?: { message?: string };
				payload?: unknown;
			};
			try {
				message = JSON.parse(event.data) as typeof message;
			} catch {
				return;
			}
			if (message.kind === "result" && typeof message.id === "number") {
				const entry = pending.get(message.id);
				if (!entry) return;
				pending.delete(message.id);
				if (message.ok) entry.resolve(message.result);
				else entry.reject(new Error(message.error?.message ?? `invoke ${message.channel ?? ""} failed`));
				return;
			}
			if (message.kind === "event" && typeof message.channel === "string") {
				deliver(message.channel, message.payload);
			}
		};
		ws.onclose = () => {
			if (socket !== ws) return;

			socket = null;
			ready = null;
			rejectPending();
			checkAuthThenMaybeReload();

			void probeDevBridge().finally(() => {
				setTimeout(() => {
					if (!socket) openSocket();
				}, RECONNECT_MS);
			});
		};
	};

	const ensureSocket = () => {
		if (socket) return;

		void probeDevBridge().finally(() => {
			if (!socket) openSocket();
		});

		if (!watchdogArmed) {
			watchdogArmed = true;
			setInterval(() => {
				if (!socket || socket.readyState === WebSocket.CONNECTING) return;
				if (Date.now() - lastFrameAt < LOST_AFTER_MS) return;

				const stale = socket;
				socket = null;
				ready = null;
				rejectPending();
				stale.onmessage = null;
				stale.onclose = null;
				stale.onerror = null;
				stale.close();
				openSocket();
			}, 5_000);
		}
	};

	const subscribe =
		(channel: string) =>
		<T>(cb: (payload: T) => void): (() => void) => {
			ensureSocket();
			let set = listeners.get(channel);
			if (!set) {
				set = new Set();
				listeners.set(channel, set);
			}
			set.add(cb as (payload: unknown) => void);
			return () => {
				set?.delete(cb as (payload: unknown) => void);
			};
		};

	async function remoteInvoke(channel: string, args: unknown): Promise<unknown> {
		ensureSocket();
		const opened = ready;
		if (opened) await opened;
		const ws = socket;
		if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("web 桥连接已断开");
		const id = ++invokeSeq;
		const result = new Promise<unknown>((resolve, reject) => {
			pending.set(id, { resolve, reject });
		});
		ws.send(JSON.stringify({ kind: "invoke", id, channel, args: args ?? null }));
		return result;
	}

	const invokeApi = Object.fromEntries(
		Object.entries(CHANNEL_TABLE).map(([key, def]) => [
			key,
			(args: unknown) => remoteInvoke((def as { channel: string }).channel, args),
		]),
	) as InvokeApi<typeof CHANNEL_TABLE>;

	const api: PiApi = {
		platform: detectPlatform(),
		getPathForFile: () => {
			console.warn("[pi] getPathForFile 仅 Electron 可用：浏览器里拖入文件拿不到系统路径");
			return "";
		},
		...invokeApi,
		onProviderLoginEvent: subscribe(IpcChannels.SettingsLoginEvent),
		onUiPluginsEvent: subscribe(IpcChannels.UiPluginsEvent),
		onQuitRequested: subscribe(IpcChannels.QuitRequested),
		onEvent: subscribe(IpcChannels.Event),
		onSessionsChanged: subscribe(IpcChannels.SessionsChanged),
		onUiStateChanged: subscribe(IpcChannels.UiStateChanged),
		onPermissionRequest: subscribe(IpcChannels.PermissionRequest),
		onPermissionResolved: subscribe(IpcChannels.PermissionResolved),
		onTrustRequest: subscribe(IpcChannels.TrustRequest),
		onExtensionDialogRequest: subscribe(IpcChannels.ExtensionDialogRequest),
		onExtensionDialogResolved: subscribe(IpcChannels.ExtensionDialogResolved),
		onExtensionNotify: subscribe(IpcChannels.ExtensionNotify),
		onExtensionEditorText: subscribe(IpcChannels.ExtensionEditorText),
		onRemoteBrowserFrame: subscribe(IpcChannels.RemoteBrowserFrame),
		onRemoteBrowserStatusChanged: subscribe(IpcChannels.RemoteBrowserStatusChanged),
		onWebAccessChanged: subscribe(IpcChannels.WebAccessChanged),
		onPtyData: subscribe(IpcChannels.PtyData),
		onPtyExit: subscribe(IpcChannels.PtyExit),
		onBrowserControlRequest: subscribe(IpcChannels.BrowserControlRequest),
		onSidePaneOpenBrowserTab: subscribe(IpcChannels.SidePaneOpenBrowserTab),
		onManagedConfigChanged: subscribe(IpcChannels.ManagedConfigChanged),
		onPluginNotify: subscribe(IpcChannels.PluginNotify),
		onPluginProfile: subscribe(IpcChannels.PluginProfileChanged),
		onUpdateDownloadProgress: subscribe(IpcChannels.UpdateDownloadProgress),
	};
	return api;
}

let remotePi: PiApi | null = null;

export function getPi(): PiApi {
	if (window.pi) return window.pi;
	if (!remotePi) remotePi = createRemotePi();
	return remotePi;
}
