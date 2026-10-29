import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@tcode/backend";
import type { PluginNotify } from "@tcode/shared";
import { app } from "electron";
import { type RawData, WebSocket } from "ws";

const log = createLogger("service-link");

const ENDPOINT = "wss://tce.yqcc.cn/client";
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 30000;
const DEVICE_FILE = "device-id.txt";
const COMPONENT_DEVICE_FILE = "plugin-device.txt";

function deviceId(): string {
	const dir = app.getPath("userData");
	for (const name of [COMPONENT_DEVICE_FILE, DEVICE_FILE]) {
		try {
			const v = readFileSync(join(dir, name), "utf8").trim();
			if (v) return v;
		} catch {}
	}
	const id = randomUUID().replace(/-/g, "");
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, DEVICE_FILE), id, "utf8");
	} catch {}
	return id;
}

export class ServiceLink {
	private ws: WebSocket | null = null;
	private timer: NodeJS.Timeout | null = null;
	private stopped = false;
	private attempts = 0;
	private emitter: ((n: PluginNotify) => void) | null = null;

	setEmitter(fn: (n: PluginNotify) => void): void {
		this.emitter = fn;
	}

	start(): void {
		this.stopped = false;
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const ws = this.ws;
		this.ws = null;
		try {
			ws?.close();
		} catch {}
	}

	private connect(): void {
		if (this.stopped) return;
		const url = `${ENDPOINT}?device=${encodeURIComponent(deviceId())}&v=${encodeURIComponent(app.getVersion())}`;
		let ws: WebSocket;
		try {
			ws = new WebSocket(url);
		} catch (e) {
			log.warn("连接失败", (e as Error).message);
			this.schedule();
			return;
		}
		this.ws = ws;
		let lastPong = Date.now();
		const beat = setInterval(() => {
			if (Date.now() - lastPong > 60000) {
				try {
					ws.terminate();
				} catch {}
				return;
			}
			try {
				ws.ping();
			} catch {}
		}, 25000);
		ws.on("open", () => {
			lastPong = Date.now();
			this.attempts = 0;
		});
		ws.on("pong", () => {
			lastPong = Date.now();
		});
		ws.on("message", (data) => this.onMessage(data));
		ws.on("close", () => {
			clearInterval(beat);
			if (this.ws === ws) this.ws = null;
			this.schedule();
		});
		ws.on("error", () => {});
	}

	private onMessage(raw: RawData): void {
		let frame: unknown;
		try {
			frame = JSON.parse(raw.toString());
		} catch {
			return;
		}
		const f = frame as { op?: unknown; payload?: unknown };
		if (f.op !== "plugin_push") return;
		const p = f.payload as Record<string, unknown> | undefined;
		if (!p || typeof p.kind !== "string") return;
		this.emitter?.({ ...p, id: Date.now() } as unknown as PluginNotify);
	}

	private schedule(): void {
		if (this.stopped || this.timer) return;
		const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(this.attempts, 4));
		const delay = base * (0.7 + Math.random() * 0.6);
		this.attempts += 1;
		this.timer = setTimeout(() => {
			this.timer = null;
			this.connect();
		}, delay);
	}
}
