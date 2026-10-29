import type { PtyDataEvent, PtyExitEvent } from "@tcode/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ComponentRunnerLike } from "./component-bridge";
import { setComponentRunnerProvider } from "./component-bridge";
import { PtyManager } from "./pty";

type PtyEvent =
	| { channel: "pty:data"; payload: PtyDataEvent }
	| { channel: "pty:exit"; payload: PtyExitEvent };

let events: PtyEvent[];

class FakePtyRunner implements ComponentRunnerLike {
	created: Array<{ ptyId: string; cwd: string; cols: number; rows: number }> = [];
	writes: Array<{ ptyId: string; data: string }> = [];
	resizes: Array<{ ptyId: string; cols: number; rows: number }> = [];
	kills: string[] = [];
	handlers = new Map<
		string,
		{ onData: (d: string) => void; onExit: (p: { code: number; error?: string }) => void }
	>();
	createResult: "ok" | "reject" | "not-ready" = "ok";

	call(): { id: number; promise: Promise<Record<string, unknown>> } | null {
		return null;
	}

	sendBridge(): boolean {
		return true;
	}

	createPty(
		req: { ptyId: string; cwd: string; cols: number; rows: number },
		handlers: { onData: (d: string) => void; onExit: (p: { code: number; error?: string }) => void },
	): Promise<boolean> | null {
		if (this.createResult === "not-ready") return null;
		if (this.createResult === "reject") return Promise.resolve(false);
		this.created.push(req);
		this.handlers.set(req.ptyId, handlers);
		return Promise.resolve(true);
	}

	writePty(ptyId: string, data: string): void {
		this.writes.push({ ptyId, data });
	}

	resizePty(ptyId: string, cols: number, rows: number): void {
		this.resizes.push({ ptyId, cols, rows });
	}

	killPty(ptyId: string): void {
		this.kills.push(ptyId);
	}

	emit(ptyId: string, data: string): void {
		this.handlers.get(ptyId)?.onData(data);
	}

	exit(ptyId: string, code: number): void {
		this.handlers.get(ptyId)?.onExit({ code });
		this.handlers.delete(ptyId);
	}
}

let fake: FakePtyRunner;

beforeEach(() => {
	events = [];
	fake = new FakePtyRunner();
	setComponentRunnerProvider(() => fake);
});

afterEach(() => {
	setComponentRunnerProvider(undefined);
});

function makeManager(): PtyManager {
	return new PtyManager((channel, payload) => {
		events.push({ channel, payload } as PtyEvent);
	});
}

function dataTexts(): string[] {
	return events
		.filter((e): e is Extract<PtyEvent, { channel: "pty:data" }> => e.channel === "pty:data")
		.map((e) => e.payload.data);
}

function exited(): PtyExitEvent[] {
	return events
		.filter((e): e is Extract<PtyEvent, { channel: "pty:exit" }> => e.channel === "pty:exit")
		.map((e) => e.payload);
}

describe("PtyManager（组件内置 ConPTY 桥接）", () => {
	it("create 传 ptyId/cwd 并夹紧尺寸", async () => {
		const manager = makeManager();
		const { id } = await manager.create({ cwd: "C:\\proj", cols: 0, rows: 0 });
		expect(id.length).toBeGreaterThan(0);
		expect(fake.created).toHaveLength(1);
		expect(fake.created[0]).toMatchObject({ ptyId: id, cwd: "C:\\proj", cols: 2, rows: 1 });
	});

	it("组件输出转发为 pty:data", async () => {
		const manager = makeManager();
		const { id } = await manager.create({ cwd: "C:\\proj", cols: 80, rows: 24 });
		fake.emit(id, "hello\r\n");
		expect(dataTexts()).toEqual(["hello\r\n"]);
	});

	it("组件退出转发为 pty:exit 且移除会话", async () => {
		const manager = makeManager();
		const { id } = await manager.create({ cwd: "C:\\proj", cols: 80, rows: 24 });
		fake.exit(id, 0);
		expect(exited()).toEqual([{ id, exitCode: 0 }]);
		manager.write(id, "x");
		expect(fake.writes).toHaveLength(0);
	});

	it("write/resize/kill 转发到组件", async () => {
		const manager = makeManager();
		const { id } = await manager.create({ cwd: "C:\\proj", cols: 80, rows: 24 });
		manager.write(id, "echo hi\r");
		manager.resize(id, 100, 30);
		manager.kill(id);
		expect(fake.writes).toEqual([{ ptyId: id, data: "echo hi\r" }]);
		expect(fake.resizes).toEqual([{ ptyId: id, cols: 100, rows: 30 }]);
		expect(fake.kills).toEqual([id]);
	});

	it("未知会话的 write/resize/kill 是幂等空操作", () => {
		const manager = makeManager();
		expect(() => manager.write("nope", "x")).not.toThrow();
		expect(() => manager.resize("nope", 80, 24)).not.toThrow();
		expect(() => manager.kill("nope")).not.toThrow();
		expect(fake.writes).toHaveLength(0);
		expect(fake.kills).toHaveLength(0);
	});

	it("组件拒绝创建时抛错并清理会话", async () => {
		fake.createResult = "reject";
		const manager = makeManager();
		await expect(manager.create({ cwd: "C:\\proj", cols: 80, rows: 24 })).rejects.toThrow(/不支持内置终端/);
		expect(() => manager.write("any", "x")).not.toThrow();
	});

	it("组件未就绪时抛错", async () => {
		fake.createResult = "not-ready";
		const manager = makeManager();
		await expect(manager.create({ cwd: "C:\\proj", cols: 80, rows: 24 })).rejects.toThrow(/组件未就绪/);
	});

	it("killAll 结束所有会话且幂等", async () => {
		const manager = makeManager();
		const a = await manager.create({ cwd: "C:\\proj", cols: 80, rows: 24 });
		const b = await manager.create({ cwd: "C:\\proj", cols: 80, rows: 24 });
		manager.killAll();
		expect(fake.kills.sort()).toEqual([a.id, b.id].sort());
		expect(() => manager.killAll()).not.toThrow();
		expect(fake.kills).toHaveLength(2);
	});
});
