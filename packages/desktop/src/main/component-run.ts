import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createLogger } from "@tcode/backend";
import type { PluginNotify, PluginProfile } from "@tcode/shared";
import { app } from "electron";

declare const __COMPONENT_SHA256__: string;
declare const __DEV_BUILD__: boolean | undefined;

const log = createLogger("component-run");

function expectedHash(): string {
	return typeof __COMPONENT_SHA256__ === "string" ? __COMPONENT_SHA256__.trim().toLowerCase() : "";
}

function isDevMode(): boolean {
	return typeof __DEV_BUILD__ === "boolean" && __DEV_BUILD__;
}

export class ComponentRunner {
	private children = new Map<string, ChildProcess>();
	private timers = new Map<string, NodeJS.Timeout>();
	private retry = new Map<string, number>();
	private dir = "";
	private stopped = false;
	private failed = false;
	private onFatal: ((reason: string) => void) | null = null;
	private emitter: ((n: PluginNotify) => void) | null = null;
	private providersHandler: ((raw: unknown) => void) | null = null;
	private profileHandler: ((p: PluginProfile) => void) | null = null;
	private licensesHandler: ((items: unknown) => void) | null = null;
	private lastIdByFile = new Map<string, number>();
	private ready = false;
	private waiters: ((ok: boolean) => void)[] = [];
	private bridges = new BridgeDispatcher();
	private ptys = new Map<
		string,
		{ onData: (data: string) => void; onExit: (payload: { code: number; error?: string }) => void }
	>();

	createPty(
		req: {
			ptyId: string;
			cwd: string;
			cols: number;
			rows: number;
			env?: Record<string, string>;
			shell?: string;
		},
		handlers: {
			onData: (data: string) => void;
			onExit: (payload: { code: number; error?: string }) => void;
		},
	): Promise<boolean> | null {
		if (this.stopped || this.ptys.has(req.ptyId)) return null;
		this.ptys.set(req.ptyId, handlers);
		const call = this.call({ cmd: "pty.create", ...req });
		if (!call) {
			this.ptys.delete(req.ptyId);
			return null;
		}
		return call.promise
			.then((payload) => {
				if (payload.ok !== true) {
					this.ptys.delete(req.ptyId);
					return false;
				}
				return true;
			})
			.catch(() => {
				this.ptys.delete(req.ptyId);
				return false;
			});
	}

	writePty(ptyId: string, data: string): void {
		this.fireBridge({ cmd: "pty.input", ptyId, data });
	}

	resizePty(ptyId: string, cols: number, rows: number): void {
		this.fireBridge({ cmd: "pty.resize", ptyId, cols, rows });
	}

	killPty(ptyId: string): void {
		this.fireBridge({ cmd: "pty.kill", ptyId });
	}

	private fireBridge(req: {
		cmd: string;
		ptyId?: string;
		data?: string;
		cols?: number;
		rows?: number;
	}): void {
		const call = this.call(req);
		if (!call) return;
		void call.promise.catch(() => undefined);
		setTimeout(() => this.bridges.release(call.id), 5000);
	}

	call(
		req: {
			cmd: string;
			args?: string[];
			cwd?: string;
			gitDir?: string;
			workTree?: string;
			script?: string;
			timeoutMs?: number;
			session?: number;
			env?: Record<string, string>;
			ptyId?: string;
			cols?: number;
			rows?: number;
			data?: string;
			shell?: string;
		},
		onStream?: (data: string, stream: "out" | "err") => void,
	): { id: number; promise: Promise<Record<string, unknown>> } | null {
		if (this.stopped) return null;
		const requestTimeout = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs + 10_000 : 60_000;
		const id = this.bridges.alloc(onStream, requestTimeout);
		const promise = this.bridges.wait(id);
		let wrote = false;
		for (const child of this.children.values()) {
			try {
				child.stdin?.write(`${JSON.stringify({ ...req, id })}\n`);
				wrote = true;
			} catch (e) {
				log.warn("桥接请求写入失败", { error: (e as Error).message });
			}
		}
		if (!wrote) {
			this.bridges.release(id);
			return null;
		}
		return { id, promise };
	}

	sendBridge(req: { cmd: string; session?: number; args?: string[] }): boolean {
		if (this.stopped) return false;
		let wrote = false;
		for (const child of this.children.values()) {
			try {
				child.stdin?.write(`${JSON.stringify({ ...req, id: 0 })}\n`);
				wrote = true;
			} catch (e) {
				log.warn("桥接命令写入失败", { error: (e as Error).message });
			}
		}
		return wrote;
	}

	setFatalHandler(fn: (reason: string) => void): void {
		this.onFatal = fn;
	}

	setEmitter(fn: (n: PluginNotify) => void): void {
		this.emitter = fn;
	}

	setProvidersHandler(fn: (raw: unknown) => void): void {
		this.providersHandler = fn;
	}

	setProfileHandler(fn: (p: PluginProfile) => void): void {
		this.profileHandler = fn;
	}

	setLicensesHandler(fn: (items: unknown) => void): void {
		this.licensesHandler = fn;
	}

	waitReady(timeoutMs: number): Promise<boolean> {
		if (this.ready) return Promise.resolve(true);
		if (this.failed) return Promise.resolve(false);
		if (isDevMode() && this.children.size === 0) return Promise.resolve(true);
		return new Promise((finish) => {
			const timer = setTimeout(() => {
				if (isDevMode()) {
					log.warn("开发模式组件未在超时内就绪，继续启动", { timeoutMs });
					finish(true);
					return;
				}
				finish(false);
			}, timeoutMs);
			this.waiters.push((ok) => {
				clearTimeout(timer);
				finish(ok);
			});
		});
	}

	private markReady(ok: boolean): void {
		if (ok) this.ready = true;
		const list = this.waiters;
		this.waiters = [];
		for (const fn of list) fn(ok);
	}

	private onLine(file: string, line: string): void {
		const s = line.trim();
		if (!s.startsWith("{")) return;
		let frame: Record<string, unknown>;
		try {
			frame = JSON.parse(s) as Record<string, unknown>;
		} catch {
			return;
		}
		switch (frame.type) {
			case "providers":
				this.markReady(true);
				this.providersHandler?.(frame.payload);
				return;
			case "profile":
				this.markReady(true);
				this.profileHandler?.(frame.payload as PluginProfile);
				return;
			case "licenses":
				this.markReady(true);
				this.licensesHandler?.(frame.payload);
				return;
			case "notify": {
				const n = frame.payload as Record<string, unknown> | undefined;
				if (!n || typeof n.id !== "number") return;
				const last = this.lastIdByFile.get(file) ?? -1;
				if (n.id <= last) return;
				this.lastIdByFile.set(file, n.id);
				this.markReady(true);
				this.emitter?.(n as unknown as PluginNotify);
				return;
			}
			case "pty_output": {
				const p = frame.payload as { ptyId?: unknown; data?: unknown } | undefined;
				if (p && typeof p.ptyId === "string") {
					this.markReady(true);
					this.ptys.get(p.ptyId)?.onData(typeof p.data === "string" ? p.data : "");
				}
				return;
			}
			case "pty_exit": {
				const p = frame.payload as { ptyId?: unknown; code?: unknown; error?: unknown } | undefined;
				if (p && typeof p.ptyId === "string") {
					const session = this.ptys.get(p.ptyId);
					this.ptys.delete(p.ptyId);
					session?.onExit({
						code: typeof p.code === "number" ? p.code : -1,
						error: typeof p.error === "string" ? p.error : undefined,
					});
				}
				return;
			}
			case "bridge": {
				const payload = frame.payload as Record<string, unknown> | undefined;
				if (payload && typeof payload.id === "number") {
					this.markReady(true);
					this.bridges.dispatch(payload.id, payload);
				}
				return;
			}
			case "bridge_stream": {
				const payload = frame.payload as Record<string, unknown> | undefined;
				if (payload && typeof payload.id === "number") {
					this.bridges.dispatchStream(payload.id, payload);
				}
				return;
			}
			default:
				return;
		}
	}

	send(cmd: string): boolean {
		if (this.stopped) return false;
		let wrote = false;
		for (const child of this.children.values()) {
			try {
				child.stdin?.write(`${JSON.stringify({ cmd })}\n`);
				wrote = true;
			} catch (e) {
				log.warn("命令写入失败", { error: (e as Error).message });
			}
		}
		return wrote;
	}

	start(): void {
		this.stopped = false;
		this.dir = join(app.getPath("userData"), "component");
		this.seedBundled();
		const files = this.listRunnable();
		if (files.length === 0) {
			if (isDevMode()) {
				log.warn("开发模式未找到运行时组件，跳过启动");
				return;
			}
			this.fatal("missing");
			return;
		}
		if (!this.verify(files)) {
			this.fatal("corrupt");
			return;
		}
		for (const f of files) this.launch(f);
	}

	private verify(files: string[]): boolean {
		if (isDevMode()) return true;
		const want = expectedHash();
		if (!want) return false;
		for (const f of files) {
			try {
				if (
					createHash("sha256")
						.update(readFileSync(join(this.dir, f)))
						.digest("hex") === want
				)
					return true;
			} catch {}
		}
		return false;
	}

	private listRunnable(dir: string = this.dir): string[] {
		if (!existsSync(dir)) return [];
		let files: string[] = [];
		try {
			files = readdirSync(dir);
		} catch {
			return [];
		}
		const out: string[] = [];
		for (const f of files) {
			if (!/\.(exe|cmd|bat)$/i.test(f)) continue;
			try {
				if (!statSync(join(dir, f)).isFile()) continue;
			} catch {
				continue;
			}
			out.push(f);
		}
		return out;
	}

	private fatal(reason: string): void {
		if (this.stopped || this.failed) return;
		this.failed = true;
		this.stopped = true;
		log.error("启动中止", { reason });
		this.markReady(false);
		this.onFatal?.(reason);
	}

	private seedBundled(): void {
		if (isDevMode()) {
			this.seedFromDevSource();
			return;
		}
		const src = join(process.resourcesPath, "component", "component.exe");
		if (!existsSync(src)) return;
		try {
			mkdirSync(this.dir, { recursive: true });
			copyFileSync(src, join(this.dir, "component.exe"));
		} catch (e) {
			log.warn("内置文件释放失败", { error: (e as Error).message });
		}
	}

	private devSourceDirs(): string[] {
		const explicit = process.env.TCODE_COMPONENT_DIR?.trim();
		if (explicit) return [explicit];
		return [join(app.getAppPath(), "resources", "component")];
	}

	private seedFromDevSource(): void {
		if (process.env.TCODE_COMPONENT_DISABLE === "1") return;
		const source = this.devSourceDirs().find((d) => this.listRunnable(d).length > 0);
		if (!source) return;
		if (resolve(source) === resolve(this.dir)) return;
		const files = this.listRunnable(source);
		try {
			mkdirSync(this.dir, { recursive: true });
		} catch (e) {
			log.warn("组件目录创建失败", { dir: this.dir, error: (e as Error).message });
			return;
		}
		for (const f of files) {
			const src = join(source, f);
			const dest = join(this.dir, f);
			try {
				const srcStat = statSync(src);
				if (existsSync(dest)) {
					const destStat = statSync(dest);
					if (destStat.size === srcStat.size && destStat.mtimeMs >= srcStat.mtimeMs) continue;
				}
				copyFileSync(src, dest);
				log.info("开发模式已识别运行时组件", { from: src, to: dest });
			} catch (e) {
				log.warn("组件复制失败", { file: f, error: (e as Error).message });
			}
		}
	}

	private launch(f: string): void {
		if (this.stopped || this.children.has(f)) return;
		const full = join(this.dir, f);
		const startedAt = Date.now();
		this.lastIdByFile.delete(f);
		try {
			const env: NodeJS.ProcessEnv = {
				...process.env,
				TCODE_USER_DATA: app.getPath("userData"),
				TCODE_APP_VERSION: app.getVersion(),
			};
			const child = spawn(full, [], {
				detached: false,
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
				cwd: this.dir,
				env,
			});
			this.children.set(f, child);
			if (child.stdout) {
				createInterface({ input: child.stdout }).on("line", (line) => this.onLine(f, line));
			}
			if (child.stderr) {
				createInterface({ input: child.stderr }).on("line", (line) => {
					if (line.trim()) log.info("组件日志", { line: line.trim() });
				});
			}
			child.stdin?.on("error", () => {});
			setTimeout(
				() => {
					if (child.exitCode === null && !child.killed) this.markReady(true);
				},
				app.isPackaged ? 5000 : 1200,
			);
			child.on("error", (e) => {
				log.warn("启动失败", { file: f, error: e.message });
				this.children.delete(f);
				if ((this.retry.get(f) ?? 0) >= 3) {
					this.fatal("unavailable");
					return;
				}
				this.scheduleRetry(f);
			});
			child.on("exit", (code) => {
				this.children.delete(f);
				this.failPtys("组件已退出");
				this.bridges.failAll("运行时组件已退出");
				if (this.stopped) return;

				const alive = Date.now() - startedAt;
				if (alive > 20000) this.retry.set(f, 0);
				log.info("进程退出，稍后重启", { file: f, code });
				this.scheduleRetry(f);
			});
			log.info("进程已启动", { file: f });
		} catch (e) {
			log.warn("进程启动异常", { file: f, error: (e as Error).message });
		}
	}

	private scheduleRetry(f: string): void {
		if (this.stopped || this.timers.has(f)) return;
		const n = (this.retry.get(f) ?? 0) + 1;
		this.retry.set(f, n);
		if (n > 5) {
			this.fatal("corrupt");
			return;
		}
		const delay = Math.min(30000, 2000 * n);
		const t = setTimeout(() => {
			this.timers.delete(f);
			this.launch(f);
		}, delay);
		this.timers.set(f, t);
	}

	private failPtys(reason: string): void {
		const sessions = [...this.ptys.values()];
		this.ptys.clear();
		for (const s of sessions) s.onExit({ code: -1, error: reason });
	}

	stop(): void {
		this.stopped = true;
		this.failPtys("应用已退出");
		this.bridges.failAll("应用已退出");
		for (const t of this.timers.values()) clearTimeout(t);
		this.timers.clear();
		for (const c of this.children.values()) {
			try {
				c.kill();
			} catch {}
		}
		this.children.clear();
	}
}

class BridgeDispatcher {
	private nextId = 1;
	private pending = new Map<
		number,
		{
			resolve: (payload: Record<string, unknown>) => void;
			reject: (error: Error) => void;
			buffer: { out: string[]; err: string[] };
			onStream?: (data: string, stream: "out" | "err") => void;
			timer?: NodeJS.Timeout;
		}
	>();

	alloc(onStream?: (data: string, stream: "out" | "err") => void, timeoutMs = 0): number {
		const id = this.nextId++;
		let resolve: (payload: Record<string, unknown>) => void = () => {};
		let reject: (error: Error) => void = () => {};
		const promise = new Promise<Record<string, unknown>>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		void promise.catch(() => undefined);
		const timer =
			timeoutMs > 0
				? setTimeout(() => {
						this.fail(id, new Error(`运行时组件响应超时（${Math.round(timeoutMs / 1000)}s）`));
					}, timeoutMs)
				: undefined;
		this.pending.set(id, { resolve, reject, buffer: { out: [], err: [] }, onStream, timer });
		this.promises.set(id, promise);
		return id;
	}

	private promises = new Map<number, Promise<Record<string, unknown>>>();

	wait(id: number): Promise<Record<string, unknown>> {
		const p = this.promises.get(id);
		if (p) return p;
		return Promise.resolve({});
	}

	dispatch(id: number, payload: Record<string, unknown>): void {
		const entry = this.pending.get(id);
		if (!entry) return;
		if (entry.timer) clearTimeout(entry.timer);
		const out = entry.buffer.out.join("");
		const err = entry.buffer.err.join("");
		const merged: Record<string, unknown> = { ...payload };
		if (out && typeof merged.stdout === "undefined") merged.stdout = out;
		if (err && typeof merged.stderr === "undefined") merged.stderr = err;
		entry.resolve(merged);
		this.pending.delete(id);
		this.promises.delete(id);
	}

	dispatchStream(id: number, payload: Record<string, unknown>): void {
		const entry = this.pending.get(id);
		if (!entry) return;
		const stream = typeof payload.stream === "string" ? payload.stream : "out";
		const data = typeof payload.data === "string" ? payload.data : "";
		if (stream === "err") {
			entry.buffer.err.push(data);
		} else {
			entry.buffer.out.push(data);
		}
		entry.onStream?.(data, stream === "err" ? "err" : "out");
	}

	private fail(id: number, error: Error): void {
		const entry = this.pending.get(id);
		if (!entry) return;
		if (entry.timer) clearTimeout(entry.timer);
		this.pending.delete(id);
		this.promises.delete(id);
		entry.reject(error);
	}

	failAll(reason: string): void {
		const ids = [...this.pending.keys()];
		for (const id of ids) this.fail(id, new Error(reason));
	}

	release(id: number): void {
		const entry = this.pending.get(id);
		if (entry?.timer) clearTimeout(entry.timer);
		this.pending.delete(id);
		this.promises.delete(id);
	}
}
