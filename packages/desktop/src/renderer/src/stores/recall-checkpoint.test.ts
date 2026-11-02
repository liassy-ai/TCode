import { describe, expect, it } from "vitest";
import { pickRecallCheckpoint } from "./sessions";

const initial = { sha: "base", turn: undefined };
const turn1 = { sha: "t1", turn: 1 };
const turn2 = { sha: "t2", turn: 2 };

describe("pickRecallCheckpoint", () => {
	it("只有 initial 检查点时，撤回第 2 条消息不回退任何文件", () => {
		expect(pickRecallCheckpoint([initial], 1)).toBeNull();
	});

	it("精确命中目标轮次", () => {
		expect(pickRecallCheckpoint([initial, turn1, turn2], 1)?.sha).toBe("t1");
		expect(pickRecallCheckpoint([initial, turn1, turn2], 2)?.sha).toBe("t2");
	});

	it("目标轮次的检查点缺失时不回退（哪怕有更早的）", () => {
		expect(pickRecallCheckpoint([initial, turn1], 2)).toBeNull();
	});

	it("撤回第一条消息时回到 initial", () => {
		expect(pickRecallCheckpoint([initial, turn1], 0)?.sha).toBe("base");
	});

	it("没有 initial 时，撤回第一条消息也不乱退", () => {
		expect(pickRecallCheckpoint([turn1, turn2], 0)).toBeNull();
	});
});
