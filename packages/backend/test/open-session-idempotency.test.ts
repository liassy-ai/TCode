import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionGate } from "../src/permissions/gate";
import { PiBackend } from "../src/pi-backend";
import { ExtensionDialogHost } from "../src/session/extension-dialog-host";
import type { RegisteredSession, SessionRegistry } from "../src/session/registry";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return {
		...actual,
		createAgentSession: () => {
			throw new Error("不该构造第二个 AgentSession（应命中 registry 短路）");
		},
	};
});

const PROJECT = "/tmp/project";

function writeSessionFile(dir: string, id: string): string {
	const file = join(dir, `${id}.jsonl`);
	const lines = [
		JSON.stringify({
			type: "session",
			version: 3,
			id,
			timestamp: "2020-01-01T00:00:00.000Z",
			cwd: PROJECT,
		}),
		JSON.stringify({
			type: "message",
			id: "m1",
			parentId: null,
			timestamp: "2021-03-04T05:06:07.000Z",
			message: { role: "user", content: "hi", timestamp: Date.parse("2021-03-04T05:06:07.000Z") },
		}),
	];
	writeFileSync(file, `${lines.join("\n")}\n`);
	return file;
}

function entryFor(file: string, sessionId: string): RegisteredSession {
	return {
		session: {
			sessionId,
			sessionFile: file,
			sessionName: "已加载会话",
			model: null,
			thinkingLevel: "medium",
			messages: [],
			sessionManager: SessionManager.open(file),
		} as unknown as AgentSession,
		unsubscribe: () => {},
		cwd: PROJECT,
		gate: { dispose: () => {} },
		dialogs: { dispose: () => {} },
		modeRef: { current: "default" },
	} as unknown as RegisteredSession;
}

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "open-idempotency-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("PiBackend.openSession 幂等（spec D4）", () => {
	it("已在 registry 的会话再 open：返回现有 entry 的 meta，不替换 entry、不重复构造", async () => {
		const file = writeSessionFile(dir, "sess-open");
		const backend = new PiBackend({ projectTrust: false, permissionGates: false });
		const registry = (backend as unknown as { registry: SessionRegistry }).registry;
		vi.spyOn(
			backend as unknown as { getModelRuntime: () => Promise<ModelRuntime> },
			"getModelRuntime",
		).mockResolvedValue({} as ModelRuntime);

		const load = vi.fn(() => {
			throw new Error("不该构造第二个 AgentSession（应命中 registry 短路）");
		});
		Object.defineProperty(backend, "projectLoader", { value: { load } });

		const entry = entryFor(file, "sess-open");
		registry.add(entry);

		const meta = await backend.openSession(file);

		expect(meta.sessionId).toBe("sess-open");
		expect(meta).toEqual(registry.toMeta(entry));
		expect(registry.list()).toHaveLength(1);
		expect(registry.get("sess-open")).toBe(entry);
		expect(load).not.toHaveBeenCalled();
	});
});

describe("PiBackend.wireSession 注册冲突（D4 最后防线）", () => {
	it("同 sessionId 已被占住：抛错，并把刚构造的实例拆干净（订阅/gate/dialogs/session）", async () => {
		const file = writeSessionFile(dir, "sess-dup");
		const backend = new PiBackend({
			projectTrust: false,
			permissionGates: false,
			subagentPreferBuiltin: false,
		});
		const registry = (backend as unknown as { registry: SessionRegistry }).registry;

		const holder = entryFor(file, "sess-dup");
		registry.add(holder);

		const unsubscribe = vi.fn();
		const dispose = vi.fn();
		const gateDispose = vi.spyOn(PermissionGate.prototype, "dispose");
		const dialogsDispose = vi.spyOn(ExtensionDialogHost.prototype, "dispose");
		const session = {
			sessionId: "sess-dup",
			sessionFile: file,
			sessionName: undefined,
			model: null,
			thinkingLevel: "medium",
			messages: [],
			sessionManager: SessionManager.open(file),
			subscribe: () => unsubscribe,
			bindExtensions: () => Promise.resolve(),
			dispose,
		};
		const wire = (
			backend as unknown as {
				wireSession: (cwd: string, readOnly: undefined, make: () => Promise<unknown>) => Promise<unknown>;
			}
		).wireSession.bind(backend);

		await expect(
			wire("/tmp/project", undefined, async () => ({
				session,
				extensionsResult: { extensions: [], errors: [] },
			})),
		).rejects.toThrow(/already registered/);

		try {
			expect(unsubscribe).toHaveBeenCalledTimes(1);
			expect(gateDispose).toHaveBeenCalledTimes(1);
			expect(dialogsDispose).toHaveBeenCalledTimes(1);
			expect(dispose).toHaveBeenCalledTimes(1);

			expect(registry.get("sess-dup")).toBe(holder);
			expect(registry.list()).toHaveLength(1);
		} finally {
			gateDispose.mockRestore();
			dialogsDispose.mockRestore();
		}
	});
});
