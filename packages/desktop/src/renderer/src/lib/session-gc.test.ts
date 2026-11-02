import { describe, expect, it } from "vitest";
import {
	GC_DEFAULTS,
	isProtected,
	pickUnloadCandidates,
	type SessionGcEntry,
	type SessionGcInput,
	type SessionGcOpen,
} from "./session-gc";

const IDLE_ENTRY: SessionGcEntry = {
	agentActive: false,
	pendingPermissions: [],
	pendingDialogs: [],
	unseenCompletion: false,
	compacting: false,
	followUpQueue: [],
	messageCount: 0,
};

const NOW = 1_000_000_000;

function session(sessionId: string, lastUsedAt: number, extra: Partial<SessionGcOpen> = {}): SessionGcOpen {
	return { sessionId, lastUsedAt, messageCount: 4, ...extra };
}

function input(over: Partial<SessionGcInput> = {}): SessionGcInput {
	return {
		activeSessionId: null,
		open: [],
		entryOf: () => IDLE_ENTRY,
		now: NOW,
		...over,
	};
}

const ids = (over: Partial<SessionGcInput> = {}) =>
	pickUnloadCandidates(input(over)).map((candidate) => candidate.sessionId);

describe("pickUnloadCandidates · 单条保护条件", () => {
	it("活跃会话不卸（哪怕它是内存里最久未用的那个）", () => {
		const open = [
			session("a", NOW - 10_000_000),
			session("b", NOW - 60_000),
			session("c", NOW - 40_000),
			session("d", NOW - 20_000),
		];

		expect(ids({ activeSessionId: "a", open })).toEqual([]);
	});

	it("agent 正在跑（含等审批，isStreaming 两态都为 true）不卸", () => {
		expect(
			ids({
				open: [session("running", NOW - 10_000_000)],
				entryOf: (id) => (id === "running" ? { ...IDLE_ENTRY, agentActive: true } : IDLE_ENTRY),
			}),
		).toEqual([]);
	});

	it("有排队跟发不卸（队列只活在后端内存，卸了就丢）", () => {
		expect(
			ids({
				open: [session("q", NOW - 10_000_000)],
				entryOf: () => ({ ...IDLE_ENTRY, followUpQueue: ["随便一句"] }),
			}),
		).toEqual([]);
	});

	it("完成未读（绿点）/ 正在压缩不卸", () => {
		expect(
			ids({
				open: [session("unread", NOW - 10_000_000), session("compacting", NOW - 10_000_000)],
				entryOf: (id) =>
					id === "unread" ? { ...IDLE_ENTRY, unseenCompletion: true } : { ...IDLE_ENTRY, compacting: true },
			}),
		).toEqual([]);
	});

	it("等权限审批 / 等扩展应答不卸", () => {
		expect(
			ids({
				open: [session("perm", NOW - 10_000_000), session("dialog", NOW - 10_000_000)],
				entryOf: (id) =>
					id === "perm"
						? { ...IDLE_ENTRY, pendingPermissions: [{ id: "p1" }] }
						: { ...IDLE_ENTRY, pendingDialogs: [{ id: "d1" }] },
			}),
		).toEqual([]);
	});

	it("0 消息会话不卸（还没有会话文件，磁盘历史里查不到，卸掉 = 条目消失）", () => {
		expect(ids({ open: [session("empty", NOW - 10_000_000, { messageCount: 0 })] })).toEqual([]);
	});

	it("freshMs 内用过的不卸（防「已发送、run 还没起来」竞态），过线才进候选池", () => {
		expect(
			ids({
				open: [
					session("fresh", NOW - 1000),
					session("warm-old", NOW - 120_000),
					session("warm-new", NOW - 60_000),
				],
				keep: 1,
			}),
		).toEqual(["warm-old"]);

		expect(ids({ open: [session("fresh", NOW - 1000), session("warm", NOW - 60_000)], keep: 1 })).toEqual([]);
	});

	it("磁盘 meta 是 0 但 transcript 已有消息（本次进程内新建的会话）→ 可以卸（回归：只信 meta 就永不卸载）", () => {
		const open = [
			session("new", NOW - 80_000, { messageCount: 0 }),
			session("b", NOW - 60_000),
			session("c", NOW - 40_000),
			session("d", NOW - 20_000),
			session("e", NOW - 15_000),
		];

		expect(ids({ open })).toEqual(["b"]);

		expect(
			ids({ open, entryOf: (id) => (id === "new" ? { ...IDLE_ENTRY, messageCount: 3 } : IDLE_ENTRY) }),
		).toEqual(["new", "b"]);
	});

	it("isProtected 是保护条件的唯一事实源（接线层复用同一份判断）", () => {
		expect(isProtected(session("a", NOW), IDLE_ENTRY)).toBe(false);
		expect(isProtected(session("a", NOW), undefined)).toBe(false);
		expect(isProtected(session("a", NOW), { ...IDLE_ENTRY, agentActive: true })).toBe(true);
		expect(isProtected(session("a", NOW, { messageCount: 0 }), IDLE_ENTRY)).toBe(true);
		expect(isProtected(session("a", NOW, { messageCount: 0 }), { ...IDLE_ENTRY, messageCount: 2 })).toBe(
			false,
		);
	});
});

describe("pickUnloadCandidates · K 名额与顺序", () => {
	const four = [
		session("最久", NOW - 80_000),
		session("次久", NOW - 60_000),
		session("第三", NOW - 40_000),
		session("最近", NOW - 20_000),
	];

	it("K=3：被选中的是第 4 个最久未用的，返回顺序 = 最久未用在前", () => {
		expect(ids({ open: four })).toEqual(["最久"]);
		expect(ids({ open: [...four, session("更久", NOW - 120_000)] })).toEqual(["更久", "最久"]);
	});

	it("受保护会话不占 K 名额（3 个空闲 + 1 个运行中 → 3 个空闲全留）", () => {
		const open = [
			session("a", NOW - 60_000),
			session("b", NOW - 40_000),
			session("c", NOW - 20_000),
			session("run", NOW),
		];
		expect(
			ids({
				open,
				entryOf: (id) => (id === "run" ? { ...IDLE_ENTRY, agentActive: true } : IDLE_ENTRY),
			}),
		).toEqual([]);
	});

	it("受保护会话不占名额（多一个空闲才轮到卸最久的那个）", () => {
		const open = [
			session("a", NOW - 80_000),
			session("b", NOW - 60_000),
			session("c", NOW - 40_000),
			session("d", NOW - 20_000),
			session("run", NOW),
		];
		expect(
			ids({
				open,
				entryOf: (id) => (id === "run" ? { ...IDLE_ENTRY, agentActive: true } : IDLE_ENTRY),
			}),
		).toEqual(["a"]);
	});

	it("keep 可调（K=1 时只留最近一个）", () => {
		expect(ids({ open: four, keep: 1 })).toEqual(["最久", "次久", "第三"]);
	});
});

describe("pickUnloadCandidates · 兜底超时与边界", () => {
	it("idleTimeoutMs 兜底：即使没超 K，晾太久的空闲会话也卸（reason=idle-timeout）", () => {
		const stale = NOW - (GC_DEFAULTS.idleTimeoutMs + 1);
		const candidates = pickUnloadCandidates(
			input({ open: [session("stale", stale), session("warm", NOW - 60_000)] }),
		);
		expect(candidates).toEqual([{ sessionId: "stale", reason: "idle-timeout" }]);
	});

	it("刚过 freshMs 但没到 idleTimeoutMs：不超 K 就不卸", () => {
		expect(ids({ open: [session("warm", NOW - 60_000)] })).toEqual([]);
	});

	it("超 K 优先于兜底（reason=over-limit），两者不重叠", () => {
		const stale = NOW - (GC_DEFAULTS.idleTimeoutMs + 1);
		const candidates = pickUnloadCandidates(
			input({
				open: [
					session("stale", stale),
					session("b", NOW - 60_000),
					session("c", NOW - 40_000),
					session("d", NOW - 20_000),
					session("e", NOW - 15_000),
				],
			}),
		);
		expect(candidates.map((c) => [c.sessionId, c.reason])).toEqual([
			["stale", "over-limit"],
			["b", "over-limit"],
		]);
	});

	it("空输入 / 无 active 不抛错", () => {
		expect(pickUnloadCandidates(input())).toEqual([]);
		expect(pickUnloadCandidates(input({ activeSessionId: null, open: [] }))).toEqual([]);
	});
});

describe("pickUnloadCandidates · 频道订阅保护（P0）", () => {
	it("订阅会话不成为候选，也不占 K 名额（超 K 只卸别人）", () => {
		const open = [
			session("sub", NOW - 10_000_000, { hasChannelSubscriptions: true }),
			session("b", NOW - 60_000),
			session("c", NOW - 40_000),
			session("d", NOW - 20_000),
		];
		expect(ids({ open })).toEqual([]);
		expect(ids({ open: [...open, session("e", NOW - 15_000)] })).toEqual(["b"]);
	});

	it("晾过 idleTimeoutMs 的订阅会话照样不卸（订阅 = 明确驻留语义）", () => {
		const stale = NOW - (GC_DEFAULTS.idleTimeoutMs + 1);
		expect(ids({ open: [session("sub", stale, { hasChannelSubscriptions: true })] })).toEqual([]);
	});

	it("isProtected 是保护条件的唯一事实源（订阅条件也在这里）", () => {
		expect(isProtected(session("a", NOW, { hasChannelSubscriptions: true }), IDLE_ENTRY)).toBe(true);
		expect(isProtected(session("a", NOW, { hasChannelSubscriptions: false }), IDLE_ENTRY)).toBe(false);
		expect(isProtected(session("a", NOW), IDLE_ENTRY)).toBe(false);
	});
});
