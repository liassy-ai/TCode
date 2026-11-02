import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry, SessionHeader, SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionManager as RealSessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RegisteredSession, SessionRegistry } from "../src/session/registry";

function makeEntry(
	sessionId: string,
	sessionFile: string,
): {
	entry: RegisteredSession;
	dispose: ReturnType<typeof vi.fn>;
	unsubscribe: ReturnType<typeof vi.fn>;
	gateDispose: ReturnType<typeof vi.fn>;
	dialogsDispose: ReturnType<typeof vi.fn>;
} {
	const dispose = vi.fn();
	const unsubscribe = vi.fn();
	const gateDispose = vi.fn();
	const dialogsDispose = vi.fn();
	const session = {
		sessionId,
		sessionFile,
		sessionName: undefined,
		model: null,
		thinkingLevel: "medium",
		messages: [],
		dispose,
	};
	return {
		entry: {
			session,
			unsubscribe,
			cwd: "/tmp",
			gate: { dispose: gateDispose },
			dialogs: { dispose: dialogsDispose },
			modeRef: { current: "default" },
		} as unknown as RegisteredSession,
		dispose,
		unsubscribe,
		gateDispose,
		dialogsDispose,
	};
}

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "registry-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("SessionRegistry disposeAll（B8：与 closeSession 对称）", () => {
	it("逐会话 unsubscribe + gate/dialogs/session dispose 并清空", () => {
		const registry = new SessionRegistry();
		const a = makeEntry("a", join(dir, "a.jsonl"));
		const b = makeEntry("b", join(dir, "b.jsonl"));
		registry.add(a.entry);
		registry.add(b.entry);

		registry.disposeAll();

		expect(a.dispose).toHaveBeenCalledOnce();
		expect(a.unsubscribe).toHaveBeenCalledOnce();
		expect(a.gateDispose).toHaveBeenCalledOnce();
		expect(a.dialogsDispose).toHaveBeenCalledOnce();
		expect(b.dispose).toHaveBeenCalledOnce();
		expect(b.unsubscribe).toHaveBeenCalledOnce();
		expect(registry.has("a")).toBe(false);
		expect(registry.has("b")).toBe(false);
		expect(registry.list()).toEqual([]);
	});

	it("delete（closeSession 路径）已移除的会话不会被 disposeAll 双重释放", () => {
		const registry = new SessionRegistry();
		const a = makeEntry("a", join(dir, "a.jsonl"));
		registry.add(a.entry);
		registry.delete("a");

		expect(a.gateDispose).toHaveBeenCalledOnce();
		expect(a.dialogsDispose).toHaveBeenCalledOnce();

		registry.disposeAll();

		expect(a.dispose).not.toHaveBeenCalled();
		expect(a.gateDispose).toHaveBeenCalledOnce();
	});
});

describe("SessionRegistry toMeta 时间字段（spec D1 取代 D7 的 birthtime 语义）", () => {
	const CREATED_ISO = "2020-01-01T00:00:00.000Z";
	const USER_TS = Date.parse("2021-03-04T05:06:07.000Z");

	function entryWithManager(sessionId: string, file: string, manager: unknown): RegisteredSession {
		const { entry } = makeEntry(sessionId, file);
		return {
			...entry,
			session: { ...(entry.session as unknown as object), sessionManager: manager },
		} as unknown as RegisteredSession;
	}

	function writeSession(id: string, entries: unknown[]): string {
		const file = join(dir, `${id}.jsonl`);
		const header = JSON.stringify({ type: "session", version: 3, id, timestamp: CREATED_ISO, cwd: "/tmp" });
		const body = entries.map((entry) => JSON.stringify(entry));
		writeFileSync(file, `${[header, ...body].join("\n")}\n`, "utf8");
		return file;
	}

	it("createdAt 取 session header 时间（刻意不是文件 birthtime）", () => {
		const file = writeSession("header-session", [
			{
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2021-03-04T05:06:07.000Z",
				message: { role: "user", content: "hi", timestamp: USER_TS },
			},
		]);
		const registry = new SessionRegistry();
		const entry = entryWithManager("s1", file, RealSessionManager.open(file));
		registry.add(entry);

		const meta = registry.toMeta(entry);

		expect(meta.createdAt).toBe(Date.parse(CREATED_ISO));
		expect(meta.createdAt).not.toBe(statSync(file).birthtimeMs);
		expect(meta.modifiedAt).toBe(USER_TS);
	});

	it("header 读不出来（异常路径）：回退文件 mtime（不再用 birthtime）", () => {
		const file = join(dir, "no-header.jsonl");
		writeFileSync(file, "{}\n", "utf8");
		const registry = new SessionRegistry();
		const manager = { getHeader: (): SessionHeader | null => null, getEntries: (): SessionEntry[] => [] };
		const entry = entryWithManager("s1", file, manager as unknown as SessionManager);
		registry.add(entry);

		const meta = registry.toMeta(entry);

		expect(meta.createdAt).toBe(statSync(file).mtimeMs);
		expect(meta.modifiedAt).toBe(statSync(file).mtimeMs);
	});

	it("header 与文件都不可用时回退当前时刻（不抛错）", () => {
		const registry = new SessionRegistry();
		const manager = { getHeader: (): SessionHeader | null => null, getEntries: (): SessionEntry[] => [] };
		const entry = entryWithManager("s1", join(dir, "missing.jsonl"), manager as unknown as SessionManager);

		const before = Date.now();
		const meta = registry.toMeta(entry);

		expect(meta.createdAt).toBeGreaterThanOrEqual(before);
		expect(meta.createdAt).toBeLessThanOrEqual(Date.now());
	});
});

describe("SessionRegistry.add 幂等兜底", () => {
	it("同一 sessionId 再 add 不同 entry：抛错，不静默替换旧 entry", () => {
		const registry = new SessionRegistry();
		const first = makeEntry("dup", join(dir, "dup.jsonl"));
		const second = makeEntry("dup", join(dir, "dup.jsonl"));
		registry.add(first.entry);

		expect(() => registry.add(second.entry)).toThrow();

		expect(registry.get("dup")).toBe(first.entry);
		expect(registry.list()).toHaveLength(1);
	});

	it("同 sessionId 重复 add 同一个 entry：幂等（不抛错）", () => {
		const registry = new SessionRegistry();
		const first = makeEntry("dup", join(dir, "dup.jsonl"));
		registry.add(first.entry);

		expect(() => registry.add(first.entry)).not.toThrow();
		expect(registry.list()).toHaveLength(1);
	});
});
