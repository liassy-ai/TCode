import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TraceRecorder } from "../src/session/trace";

const dirs: string[] = [];

async function tmpDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "tcode-trace-"));
	dirs.push(dir);
	return dir;
}

async function allLines(dir: string, sessionId: string): Promise<string[]> {
	const lines: string[] = [];
	const traceDir = join(dir, "traces");
	for (const f of await readdir(traceDir)) {
		if (!f.startsWith(`trace-${sessionId}`) || !f.endsWith(".jsonl")) continue;
		lines.push(...(await readFile(join(traceDir, f), "utf8")).split("\n").filter(Boolean));
	}
	return lines;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("TraceRecorder", () => {
	it("正常事件逐行落盘，close 落尽", async () => {
		const dir = await tmpDir();
		const recorder = await TraceRecorder.create(dir, "s1", { flushIntervalMs: 60_000 });
		recorder.record({ type: "agent_start" });
		recorder.record({ type: "turn_start" });
		await recorder.close();
		const lines = await allLines(dir, "s1");
		expect(lines).toHaveLength(2);

		expect(JSON.parse(lines[0])).toMatchObject({ type: "agent_start" });
		expect(typeof (JSON.parse(lines[0]) as { ts?: unknown }).ts).toBe("number");
		expect(typeof (JSON.parse(lines[1]) as { ts?: unknown }).ts).toBe("number");
	});

	it("null/非对象事件保持原序列化（不包 ts 壳）", async () => {
		const dir = await tmpDir();
		const recorder = await TraceRecorder.create(dir, "s1b", { flushIntervalMs: 60_000 });
		recorder.record(undefined);
		await recorder.close();
		const lines = await allLines(dir, "s1b");
		expect(lines).toEqual(["null"]);
	});

	it("巨型事件只记截断标记（单行可 parse、带 bytes）", async () => {
		const dir = await tmpDir();
		const recorder = await TraceRecorder.create(dir, "s2", {
			flushIntervalMs: 60_000,
			maxEventBytes: 1024,
		});
		recorder.record({ type: "message_update", huge: "x".repeat(50 * 1024) });
		recorder.record({ type: "turn_start" });
		await recorder.close();
		const lines = await allLines(dir, "s2");
		expect(lines).toHaveLength(2);
		const marker = JSON.parse(lines[0]);

		expect(marker).toMatchObject({ _truncated: true, type: "trace_gap", originalType: "message_update" });
		expect(typeof marker.ts).toBe("number");
		expect(marker.bytes).toBeGreaterThan(50 * 1024);
		expect(lines[0].length).toBeLessThan(200);
	});

	it("会话进行中按字节轮转（不再只查一次），归档保留最近 5 份", async () => {
		const dir = await tmpDir();
		const sessionId = "s3";

		const recorder = await TraceRecorder.create(dir, sessionId, {
			flushIntervalMs: 60_000,
			rotateSizeBytes: 1024,
		});
		for (let i = 0; i < 128 * 12; i++) {
			recorder.record({ type: "tick", i, pad: "y".repeat(32) });
			if (i % 128 === 127) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}
		await recorder.close();
		const files = (await readdir(join(dir, "traces"))).filter((f) => f.startsWith(`trace-${sessionId}`));
		const archives = files.filter((f) => f !== `trace-${sessionId}.jsonl`);
		expect(archives.length).toBe(5);
		for (const f of files) {
			const { size } = await stat(join(dir, "traces", f));

			expect(size).toBeLessThan(1024 + 128 * 128);
		}

		const lines = await allLines(dir, sessionId);
		expect(lines.length).toBeGreaterThanOrEqual(128 * 4 + 1);
		expect(lines.map((line) => JSON.parse(line))).toContainEqual(
			expect.objectContaining({ type: "tick", i: 128 * 12 - 1, pad: "y".repeat(32) }),
		);
	});

	it("截断标记行可被 reducer 安全消费（replay 含标记行的事故 trace 不崩）", async () => {
		const dir = await tmpDir();
		const recorder = await TraceRecorder.create(dir, "s5", {
			flushIntervalMs: 60_000,
			maxEventBytes: 1024,
		});

		recorder.record({ type: "message_update", huge: "x".repeat(50 * 1024) });
		await recorder.close();
		const [line] = await allLines(dir, "s5");
		const { emptyTranscript, reduceEvent } = await import("@tcode/shared");
		const streaming = reduceEvent(emptyTranscript(), { type: "agent_start" } as never);

		expect(reduceEvent(streaming, JSON.parse(line ?? "{}") as never)).toBe(streaming);
	});

	it("recordCustom 合成 trace_custom 行：可 parse 且 reducer no-op（replay 不崩）", async () => {
		const dir = await tmpDir();
		const { SessionTraces } = await import("../src/session/traces");
		const traces = new SessionTraces();
		await traces.start("s-custom", dir);
		traces.record("s-custom", { type: "agent_start" } as never);

		traces.recordCustom("s-custom", "evap_batch", {
			tier: 2,
			usagePct: 91.2,
			snipped: 3,
			pruned: 12,
			savedEstTokens: 48210,
			wireEstTokens: 121000,
			cacheHits: 34,
			mapSize: 49,
		});
		traces.record("s-custom", { type: "turn_start" } as never);

		traces.recordCustom("no-such-session", "evap_batch", { tier: 0 });
		await traces.stop("s-custom");

		const lines = await allLines(dir, "s-custom");
		expect(lines).toHaveLength(3);
		const custom = JSON.parse(lines[1] ?? "{}") as {
			type: string;
			kind: string;
			data: Record<string, unknown>;
			ts: number;
		};
		expect(custom.type).toBe("trace_custom");
		expect(custom.kind).toBe("evap_batch");
		expect(custom.data.pruned).toBe(12);
		expect(custom.ts).toBeGreaterThan(0);

		const { emptyTranscript, reduceEvent } = await import("@tcode/shared");
		const state = reduceEvent(emptyTranscript(), { type: "agent_start" } as never);
		const nextState = reduceEvent(state, { type: "turn_start" } as never);
		expect(reduceEvent(nextState, JSON.parse(lines[1] ?? "{}") as never)).toBe(nextState);
	});

	it("create 时已有超大文件先轮转（按注入限额判定）", async () => {
		const dir = await tmpDir();
		const sessionId = "s6";

		const traceDir = join(dir, "traces");
		await mkdir(traceDir, { recursive: true });
		await writeFile(join(traceDir, `trace-${sessionId}.jsonl`), "x".repeat(2048));
		const recorder = await TraceRecorder.create(dir, sessionId, {
			flushIntervalMs: 60_000,
			rotateSizeBytes: 1024,
		});
		recorder.record({ type: "agent_start" });
		await recorder.close();
		const files = await readdir(traceDir);
		const archives = files.filter((f) => f !== `trace-${sessionId}.jsonl`);
		expect(archives).toHaveLength(1);

		const active = await readFile(join(traceDir, `trace-${sessionId}.jsonl`), "utf8");
		expect(JSON.parse(active.trim())).toMatchObject({ type: "agent_start" });
		expect((await readFile(join(traceDir, archives[0] ?? ""), "utf8")).length).toBe(2048);
	});

	it("重开非超限活跃文件时不把它当作归档清理", async () => {
		const dir = await tmpDir();
		const sessionId = "s7";
		const traceDir = join(dir, "traces");
		await mkdir(traceDir, { recursive: true });
		for (let i = 0; i < 5; i++) {
			await writeFile(join(traceDir, `trace-${sessionId}.archive-${i}.jsonl`), `archive-${i}\n`);
		}
		const activePath = join(traceDir, `trace-${sessionId}.jsonl`);
		await writeFile(activePath, "active\n");
		const recorder = await TraceRecorder.create(dir, sessionId, { flushIntervalMs: 60_000 });
		await recorder.close();
		const files = await readdir(traceDir);
		expect(await readFile(activePath, "utf8")).toBe("active\n");
		expect(files.filter((f) => f !== `trace-${sessionId}.jsonl`)).toHaveLength(5);
	});

	it("缓冲字节超限：丢最旧保最新并留标记", async () => {
		const dir = await tmpDir();
		const recorder = await TraceRecorder.create(dir, "s4", {
			flushIntervalMs: 60_000,
			maxBufferBytes: 2048,
		});
		for (let i = 0; i < 100; i++) {
			recorder.record({ type: "tick", i, pad: "z".repeat(100) });
		}
		await recorder.close();
		const lines = await allLines(dir, "s4");
		const markers = lines.filter((l) => l.includes("buffer_overflow"));
		expect(markers.length).toBeGreaterThanOrEqual(1);

		const parsed = lines.map((l) => JSON.parse(l) as { type?: string; i?: number });
		expect(parsed.some((p) => p.i === 99)).toBe(true);
		expect(parsed.some((p) => p.i === 0)).toBe(false);
	});
});
