import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname, networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
	IpcChannels,
	type RemoteBrowserFrame,
	type WebAccessScope,
	type WebAccessStatus,
} from "@tcode/shared";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { invokeRegistry } from "./ipc/invoke";

const WS_PATH = "/api/ws";

const AUTH_CHECK_PATH = "/api/auth-check";
const HEARTBEAT_MS = 25_000;

const LOST_AFTER_MS = 70_000;

const FRAME_HEADER = "PF1 ";

const AUTH_COOKIE = "tcode_access_token";

const AUTH_MAX_AGE_S = 365 * 24 * 60 * 60;

const AUTH_DENIED_TEXT =
	"需要访问口令：请在桌面端 TCode「设置 → 网页访问」复制访问链接（含口令）后打开。\n" +
	"Access token required — copy the access link from TCode desktop: Settings → Web access.";

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json; charset=utf-8",
};

export interface WebBridgeServiceOptions {
	configPath: string;

	rendererDir: string;

	devUrl: string;

	defaultPort: number;
}

const bridgeClients = new Set<WebSocket>();

const FRAME_BACKPRESSURE_BYTES = 512 * 1024;

export function broadcastBridgeEvent(channel: string, payload: unknown): void {
	if (bridgeClients.size === 0) return;
	if (channel === IpcChannels.RemoteBrowserFrame) {
		const frame = payload as RemoteBrowserFrame;
		const match = /^data:image\/jpeg;base64,(.+)$/.exec(frame.dataUrl);
		if (!match?.[1]) return;
		const message = Buffer.concat([
			Buffer.from(`${FRAME_HEADER}${frame.id}\n`, "utf8"),
			Buffer.from(match[1], "base64"),
		]);
		for (const client of bridgeClients) {
			if (client.bufferedAmount > FRAME_BACKPRESSURE_BYTES) continue;
			try {
				client.send(message);
			} catch {}
		}
		return;
	}

	let message: string;
	try {
		message = JSON.stringify({ kind: "event", channel, payload });
	} catch {
		return;
	}
	for (const client of bridgeClients) {
		try {
			client.send(message);
		} catch {}
	}
}

export function hasBridgeClients(): boolean {
	return bridgeClients.size > 0;
}

interface BridgeSession {
	guests: Set<string>;

	timer: ReturnType<typeof setTimeout> | null;
}

const bridgeSessions = new Map<string, BridgeSession>();

const socketSessions = new WeakMap<WebSocket, string>();

const SESSION_GRACE_MS = 30_000;

function bindBridgeSession(ws: WebSocket, sessionId: string): void {
	let session = bridgeSessions.get(sessionId);
	if (!session) {
		session = { guests: new Set(), timer: null };
		bridgeSessions.set(sessionId, session);
	}
	if (session.timer) {
		clearTimeout(session.timer);
		session.timer = null;
	}
	socketSessions.set(ws, sessionId);
}

function releaseBridgeSession(ws: WebSocket): void {
	const sessionId = socketSessions.get(ws);
	if (!sessionId) return;
	socketSessions.delete(ws);
	const session = bridgeSessions.get(sessionId);
	if (!session || session.timer) return;
	session.timer = setTimeout(() => {
		bridgeSessions.delete(sessionId);
		const destroy = invokeRegistry.get(IpcChannels.remoteBrowserDestroy);
		if (!destroy) return;
		for (const guestId of session.guests) {
			try {
				destroy({ id: guestId });
			} catch {}
		}
	}, SESSION_GRACE_MS);
}

function localHosts(): Set<string> {
	const hosts = new Set<string>([
		"localhost",
		"127.0.0.1",
		"[::1]",
		"::1",
		hostname().toLowerCase(),
		"user.yqcc.cn",
	]);
	for (const list of Object.values(networkInterfaces())) {
		for (const ni of list ?? []) {
			if (ni && !ni.internal && ni.family === "IPv4") hosts.add(ni.address);
		}
	}
	return hosts;
}

function generateToken(): string {
	return randomBytes(24).toString("base64url");
}

function tokenMatches(candidate: string | null | undefined, expected: string): boolean {
	if (!candidate) return false;
	const a = createHash("sha256").update(candidate).digest();
	const b = createHash("sha256").update(expected).digest();
	return timingSafeEqual(a, b);
}

function cookieToken(header: string | undefined): string | null {
	if (!header) return null;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() === AUTH_COOKIE) return part.slice(eq + 1).trim();
	}
	return null;
}

function authCookieHeader(token: string): string {
	return `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE_S}`;
}

async function handleWsMessage(ws: WebSocket, raw: RawData): Promise<void> {
	let message: { kind?: string; id?: number; channel?: string; args?: unknown; session?: string };
	try {
		message = JSON.parse(raw.toString()) as typeof message;
	} catch {
		return;
	}
	if (message.kind === "hello" && typeof message.session === "string") {
		bindBridgeSession(ws, message.session);
		return;
	}
	if (message.kind !== "invoke" || typeof message.id !== "number") return;
	const id = message.id;
	const channel = typeof message.channel === "string" ? message.channel : "";
	const handler = invokeRegistry.get(channel);
	try {
		if (!handler) throw new Error(`unknown channel: ${channel}`);
		const result = await handler(message.args ?? undefined);

		const sessionId = socketSessions.get(ws);
		const session = sessionId ? bridgeSessions.get(sessionId) : undefined;
		if (session) {
			if (channel === IpcChannels.remoteBrowserCreate) {
				const guestId = (result as { id?: unknown } | null)?.id;
				if (typeof guestId === "string") session.guests.add(guestId);
			} else if (channel === IpcChannels.remoteBrowserDestroy) {
				const guestId = (message.args as { id?: string } | null)?.id;
				if (guestId) session.guests.delete(guestId);
			}
		}
		ws.send(JSON.stringify({ kind: "result", id, ok: true, result: result ?? null }));
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		ws.send(JSON.stringify({ kind: "result", id, ok: false, error: { message: text } }));
	}
}

const GZIP_MIN_BYTES = 1024;

const GZIP_CACHE_MAX_BYTES = 32 * 1024 * 1024;

const gzipCache = new Map<string, Buffer>();

let gzipCacheBytes = 0;

function acceptsGzip(req: IncomingMessage): boolean {
	return (req.headers["accept-encoding"] ?? "").includes("gzip");
}

function compressibleType(contentType: string): boolean {
	const ct = contentType.toLowerCase();
	return /text\/|json|javascript|ecmascript|svg|xml/.test(ct);
}

function gzipCached(file: string, body: Buffer): Buffer {
	const key = `${file}:${body.length}`;
	const hit = gzipCache.get(key);
	if (hit) return hit;
	const compressed = gzipSync(body);
	if (gzipCacheBytes + compressed.length > GZIP_CACHE_MAX_BYTES) {
		gzipCache.clear();
		gzipCacheBytes = 0;
	}
	gzipCache.set(key, compressed);
	gzipCacheBytes += compressed.length;
	return compressed;
}

function handleStatic(req: IncomingMessage, res: ServerResponse, rendererDir: string, pathname: string): void {
	const root = resolve(rendererDir);
	const rel =
		pathname === "/" ? "index.html" : normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, "");
	const file = resolve(join(root, rel));
	if (!file.startsWith(root)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	const wantsGzip = acceptsGzip(req);
	const serve = (body: Buffer, contentType: string, cacheControl?: string): void => {
		const headers: Record<string, string> = { "content-type": contentType };
		if (cacheControl) headers["cache-control"] = cacheControl;
		if (wantsGzip && body.length >= GZIP_MIN_BYTES && compressibleType(contentType)) {
			headers["content-encoding"] = "gzip";
			headers.vary = "accept-encoding";
			headers["content-length"] = String(
				extname(file) === ".html" ? gzipSync(body).length : gzipCached(file, body).length,
			);
		}
		res.writeHead(200, headers);
		if (headers["content-encoding"] === "gzip") {
			res.end(extname(file) === ".html" ? gzipSync(body) : gzipCached(file, body));
			return;
		}
		res.end(body);
	};
	try {
		const body = readFileSync(file);

		serve(body, CONTENT_TYPES[extname(file)] ?? "application/octet-stream", extname(file) === ".html" ? "no-store" : undefined);
		return;
	} catch {}
	try {
		serve(readFileSync(join(root, "index.html")), "text/html; charset=utf-8", "no-store");
	} catch {
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("renderer build not found (run `npm run build`)");
	}
}

function devFallbackPage(devUrl: string): string {
	return `<!doctype html><meta charset="utf-8"><title>TCode</title>
<body style="font:14px/1.6 system-ui;background:#17171a;color:#e7e7ea;padding:40px">
<h2 style="margin:0 0 8px">TCode 网页访问已就绪（dev 模式）</h2>
<p>未找到构建产物 <code>out/renderer</code>。开发时直接用 Vite 页面即可（它会自动连本桥）：</p>
<p><a style="color:#7c9cff" href="${devUrl}">${devUrl}</a></p>
<p style="color:#9a9aa2">打包版（npm run build）后本地址会直接提供完整界面。</p>
</body>`;
}

export class WebBridgeService {
	private config: { enabled: boolean; port: number; scope: WebAccessScope; token: string };
	private server: Server | null = null;
	private listening = false;

	private allowedHosts: Set<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

	constructor(private readonly options: WebBridgeServiceOptions) {
		this.config = { enabled: false, port: options.defaultPort, scope: "local", token: generateToken() };
	}

	async init(): Promise<void> {
		try {
			const parsed = JSON.parse(readFileSync(this.options.configPath, "utf8")) as {
				enabled?: boolean;
				port?: number;
				scope?: WebAccessScope;
				token?: unknown;
			};
			const port = parsed.port;
			const token =
				typeof parsed.token === "string" && parsed.token.length >= 16 ? parsed.token : generateToken();
			this.config = {
				enabled: parsed.enabled === true,
				port:
					Number.isInteger(port) && (port as number) >= 1024 && (port as number) <= 65535
						? (port as number)
						: this.options.defaultPort,
				scope: parsed.scope === "lan" ? "lan" : parsed.scope === "internet" ? "internet" : "local",
				token,
			};

			if (token !== parsed.token) this.save();
		} catch {
			this.config = {
				enabled: false,
				port: this.options.defaultPort,
				scope: "local",
				token: generateToken(),
			};
		}
		if (this.config.enabled) await this.start();
	}

	status(): WebAccessStatus {
		const address = this.config.scope === "lan" ? (this.lanIp() ?? "127.0.0.1") : "127.0.0.1";
		return {
			enabled: this.config.enabled,
			listening: this.listening,
			port: this.listening ? this.port() : this.config.port,
			scope: this.config.scope,
			url: this.listening ? `http://${address}:${this.port()}` : null,
			token: this.config.token,
		};
	}

	regenerateToken(): WebAccessStatus {
		this.config.token = generateToken();
		this.save();
		for (const client of bridgeClients) {
			try {
				client.close(4401, "token rotated");
			} catch {}
		}
		return this.status();
	}

	async setEnabled(enabled: boolean, port?: number): Promise<WebAccessStatus> {
		if (port !== undefined) {
			if (!Number.isInteger(port) || port < 1024 || port > 65535) {
				throw new Error(`非法端口：${port}（需 1024-65535）`);
			}
			if (port !== this.config.port) {
				const wasListening = this.listening;
				await this.stop();
				this.config.port = port;
				if (wasListening) await this.start();
			}
		}
		if (enabled && !this.listening) {
			await this.start();
		} else if (!enabled && this.listening) {
			await this.stop();
		}
		this.config.enabled = enabled;
		this.save();
		return this.status();
	}

	async setScope(scope: WebAccessScope): Promise<WebAccessStatus> {
		if (scope !== "local" && scope !== "lan" && scope !== "internet")
			throw new Error(`非法监听范围：${scope}`);
		if (scope !== this.config.scope) {
			const wasListening = this.listening;
			await this.stop();
			this.config.scope = scope;
			if (wasListening) await this.start();
			this.save();
		}
		return this.status();
	}

	async stop(): Promise<void> {
		if (!this.server) return;
		for (const client of bridgeClients) {
			try {
				client.terminate();
			} catch {}
		}
		bridgeClients.clear();
		const server = this.server;
		this.server = null;
		this.listening = false;

		server.closeAllConnections();
		await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
	}

	private port(): number {
		if (this.server) {
			const address = this.server.address();
			if (address && typeof address === "object") return address.port;
		}
		return this.config.port;
	}

	private lanIp(): string | null {
		for (const list of Object.values(networkInterfaces())) {
			for (const ni of list ?? []) {
				if (ni && !ni.internal && ni.family === "IPv4") return ni.address;
			}
		}
		return null;
	}

	private cookieAuthorized(req: IncomingMessage): boolean {
		return tokenMatches(cookieToken(req.headers.cookie), this.config.token);
	}

	private queryAuthorized(url: URL): boolean {
		return tokenMatches(url.searchParams.get("token"), this.config.token);
	}

	private originAllowed(origin: string | undefined): boolean {
		if (!origin) return true;
		try {
			return this.allowedHosts.has(new URL(origin).hostname.toLowerCase());
		} catch {
			return false;
		}
	}

	private async start(): Promise<void> {
		if (this.server) return;
		const { rendererDir, devUrl } = this.options;
		const hasBuild = existsSync(join(rendererDir, "index.html"));

		this.allowedHosts = localHosts();

		const server: Server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (req.method !== "GET") {
				res.writeHead(405).end();
				return;
			}

			if (url.pathname === AUTH_CHECK_PATH) {
				const headers: Record<string, string> = { "cache-control": "no-store" };
				const origin = req.headers.origin;
				if (origin && this.originAllowed(origin)) {
					headers["access-control-allow-origin"] = origin;
					headers["access-control-allow-credentials"] = "true";
					headers.vary = "Origin";
				}
				res.writeHead(this.cookieAuthorized(req) || this.queryAuthorized(url) ? 204 : 401, headers);
				res.end();
				return;
			}

			if (!this.cookieAuthorized(req)) {
				if (this.queryAuthorized(url)) {
					url.searchParams.delete("token");
					const search = url.searchParams.toString();
					res.writeHead(302, {
						location: `${url.pathname}${search ? `?${search}` : ""}`,
						"set-cookie": authCookieHeader(this.config.token),
						"cache-control": "no-store",
					});
					res.end();
					return;
				}
				res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
				res.end(AUTH_DENIED_TEXT);
				return;
			}
			if (!hasBuild) {
				res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
				res.end(devFallbackPage(devUrl));
				return;
			}
			handleStatic(req, res, rendererDir, url.pathname);
		});
		const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
		server.on("upgrade", (req, socket, head) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (url.pathname !== WS_PATH || !this.originAllowed(req.headers.origin)) {
				socket.write("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
				socket.destroy();
				return;
			}

			if (!this.cookieAuthorized(req) && !this.queryAuthorized(url)) {
				socket.write("HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
		});
		wss.on("connection", (ws) => {
			bridgeClients.add(ws);
			let lastPongAt = Date.now();
			const heartbeat = setInterval(() => {
				try {
					ws.send('{"kind":"ping"}');
					ws.ping();
				} catch {}
			}, HEARTBEAT_MS);
			const janitor = setInterval(() => {
				if (Date.now() - lastPongAt > LOST_AFTER_MS) ws.terminate();
			}, HEARTBEAT_MS);
			ws.on("pong", () => {
				lastPongAt = Date.now();
			});
			ws.on("message", (data) => {
				void handleWsMessage(ws, data);
			});
			ws.on("close", () => {
				clearInterval(heartbeat);
				clearInterval(janitor);
				bridgeClients.delete(ws);
				releaseBridgeSession(ws);
			});
			ws.on("error", () => {});
		});

		await new Promise<void>((resolvePromise, reject) => {
			let attempts = 0;
			const attempt = (): void => {
				server.once("listening", () => resolvePromise());
				server.once("error", (error: NodeJS.ErrnoException) => {
					server.removeAllListeners("listening");
					if (error.code === "EADDRINUSE") {
						if (attempts < 5) {
							attempts += 1;
							setTimeout(attempt, 3000);
							return;
						}
						console.warn(`[web-bridge] 端口 ${this.config.port} 已被占用，网页访问未监听`);

						resolvePromise();
						return;
					}
					reject(error);
				});
				server.listen(this.config.port, this.config.scope === "lan" ? "0.0.0.0" : "127.0.0.1");
			};
			attempt();
		});
		if (server.listening) {
			this.server = server;
			this.listening = true;
		} else {
			server.close();
		}
	}

	private save(): void {
		try {
			writeFileSync(this.options.configPath, JSON.stringify(this.config, null, 2), "utf8");
		} catch (error) {
			console.error("[web-bridge] 配置写入失败", error);
		}
	}
}
