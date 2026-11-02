import { IpcChannels, type RemoteBrowserInputEvent, type RemoteBrowserStatus } from "@tcode/shared";
import {
	app,
	BrowserWindow,
	type KeyboardInputEvent,
	type MouseInputEvent,
	type MouseWheelInputEvent,
	shell,
} from "electron";

const MIN_W = 320;
const MIN_H = 240;

const FRAME_QUALITY = 80;
const FRAME_FPS = 10;

const REMOTE_BROWSER_PARTITION = "persist:tcode-browser-remote";

export class RemoteBrowserManager {
	private guests = new Map<string, BrowserWindow>();

	private scales = new Map<string, number>();

	private paused = new Set<string>();

	setActive(id: string, active: boolean): void {
		const win = this.guests.get(id);
		if (!win) return;
		if (active) {
			this.paused.delete(id);
			win.webContents.invalidate();
		} else {
			this.paused.add(id);
		}
	}

	constructor(
		private readonly emit: (channel: string, payload: unknown) => void,
		private readonly hasClients: () => boolean,
	) {}

	async create(url: string, width: number, height: number, scale = 1): Promise<string> {
		const id = crypto.randomUUID();
		const win = new BrowserWindow({
			show: true,
			x: -10000,
			y: -10000,
			skipTaskbar: true,
			focusable: false,

			width: Math.max(MIN_W, Math.round(width * scale)),
			height: Math.max(MIN_H, Math.round(height * scale)),
			webPreferences: {
				offscreen: true,
				backgroundThrottling: false,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				partition: REMOTE_BROWSER_PARTITION,
				webviewTag: false,
			},
		});
		const contents = win.webContents;
		this.scales.set(id, scale);

		contents.setWindowOpenHandler(({ url: target }) => {
			if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
			return { action: "deny" };
		});
		contents.on("will-navigate", (event, navUrl) => {
			if (!/^(https?:|about:)/.test(navUrl)) event.preventDefault();
		});

		contents.setFrameRate(FRAME_FPS);
		contents.on("paint", (_event, _dirty, image) => {
			if (this.paused.has(id) || !this.hasClients()) return;
			const jpeg = image.toJPEG(FRAME_QUALITY);
			if (!jpeg.length) return;
			this.emit(IpcChannels.RemoteBrowserFrame, {
				id,
				dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
			});
		});

		const forceFrame = () => {
			if (this.hasClients()) contents.invalidate();

			this.emit(IpcChannels.RemoteBrowserStatusChanged, { id, status: this.status(id) });
		};
		const applyZoom = () => {
			const s = this.scales.get(id);
			if (s && s !== 1) void contents.setZoomFactor(s);
		};
		contents.on("did-navigate", () => {
			applyZoom();
			forceFrame();
		});
		contents.on("did-finish-load", () => {
			applyZoom();
			forceFrame();
		});
		contents.on("page-title-updated", forceFrame);

		this.guests.set(id, win);
		if (url && /^(https?:|about:)/.test(url)) void contents.loadURL(url);
		return id;
	}

	resize(id: string, width: number, height: number, scale?: number): void {
		const win = this.guests.get(id);
		if (!win) return;
		if (scale && scale > 0) this.scales.set(id, scale);
		const s = this.scales.get(id) ?? 1;
		win.setContentSize(Math.max(MIN_W, Math.round(width * s)), Math.max(MIN_H, Math.round(height * s)));
		if (s !== 1) void win.webContents.setZoomFactor(s);
	}

	input(id: string, event: RemoteBrowserInputEvent): void {
		const win = this.guests.get(id);
		if (!win) return;
		const wc = win.webContents;
		switch (event.type) {
			case "mouseDown":
			case "mouseUp":
			case "mouseMove": {
				const base: MouseInputEvent = {
					type: event.type,
					x: Math.round(event.x),
					y: Math.round(event.y),
					button: event.button ?? "left",
					clickCount: event.clickCount ?? 1,
					modifiers: (event.modifiers ?? []) as MouseInputEvent["modifiers"],
				};
				wc.sendInputEvent(base);
				break;
			}
			case "mouseWheel": {
				const wheel: MouseWheelInputEvent = {
					type: "mouseWheel",
					x: Math.round(event.x),
					y: Math.round(event.y),
					deltaX: event.deltaX ?? 0,
					deltaY: event.deltaY ?? 0,
					canScroll: true,
					hasPreciseScrollingDeltas: true,
					wheelTicksY: Math.sign(event.deltaY ?? 0) || undefined,
				};
				wc.sendInputEvent(wheel);

				const deltaY = event.deltaY ?? 0;
				if (Math.abs(deltaY) > 4) {
					const keyCode = deltaY > 0 ? "PageDown" : "PageUp";
					const count = Math.min(5, Math.max(1, Math.round(Math.abs(deltaY) / 250)));
					for (let i = 0; i < count; i++) wc.sendInputEvent({ type: "keyDown", keyCode, modifiers: [] });
				}
				break;
			}
			case "keyDown":
			case "keyUp": {
				const key: KeyboardInputEvent = {
					type: event.type,
					keyCode: event.keyCode,
					modifiers: (event.modifiers ?? []) as KeyboardInputEvent["modifiers"],
				};
				wc.sendInputEvent(key);
				break;
			}
			case "char": {
				wc.sendInputEvent({ type: "char", keyCode: event.keyCode });
				break;
			}
		}
	}

	status(id: string): RemoteBrowserStatus {
		const win = this.guests.get(id);
		if (!win) return { url: "", title: "" };
		return { url: win.webContents.getURL(), title: win.webContents.getTitle() };
	}

	async evaluate(id: string, code: string): Promise<unknown> {
		const win = this.guests.get(id);
		if (!win) throw new Error(`remote browser not found: ${id}`);
		return win.webContents.executeJavaScript(code, true);
	}

	destroy(id: string): void {
		const win = this.guests.get(id);
		if (!win) return;
		this.guests.delete(id);
		this.scales.delete(id);
		this.paused.delete(id);
		if (!win.isDestroyed()) win.destroy();
	}

	destroyAll(): void {
		for (const id of [...this.guests.keys()]) this.destroy(id);
	}
}

export function attachRemoteBrowserCleanup(manager: RemoteBrowserManager): void {
	app.on("before-quit", () => manager.destroyAll());
}
