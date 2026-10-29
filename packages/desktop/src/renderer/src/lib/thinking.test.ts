import { isThinkingLevel } from "@tcode/shared";
import { describe, expect, it } from "vitest";
import { THINKING_LEVELS, thinkingLevelKey, thinkingLevelPos, visibleThinkingLevels } from "./thinking";

describe("thinking 档位（shared 白名单 + renderer 收敛）", () => {
	it("白名单含 none/minimal/low/medium/high/xhigh/max 七档，非法值一律拒绝", () => {
		expect(THINKING_LEVELS).toHaveLength(7);
		expect([...THINKING_LEVELS]).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
		for (const level of THINKING_LEVELS) expect(isThinkingLevel(level)).toBe(true);
		expect(isThinkingLevel("low")).toBe(true);
		expect(isThinkingLevel("ultra")).toBe(false);
		expect(isThinkingLevel("")).toBe(false);
		expect(isThinkingLevel(undefined)).toBe(false);
		expect(isThinkingLevel(3)).toBe(false);
	});

	it("thinkingLevelPos：刻度/填充/滑块共用的归一化位置（0..1，端点对齐）", () => {
		expect(thinkingLevelPos(0, 7)).toBe(0);
		expect(thinkingLevelPos(1, 7)).toBeCloseTo(1 / 6);
		expect(thinkingLevelPos(3, 7)).toBe(0.5);
		expect(thinkingLevelPos(6, 7)).toBe(1);

		expect(thinkingLevelPos(1, 3)).toBe(0.5);

		expect(thinkingLevelPos(-1, 5)).toBe(0);
		expect(thinkingLevelPos(99, 5)).toBe(1);
		expect(thinkingLevelPos(0, 1)).toBe(0);
		expect(thinkingLevelPos(0, 0)).toBe(0);
	});

	it("thinkingLevelKey：脏值回落 medium（不至于因后端脏值渲染出 undefined）", () => {
		expect(thinkingLevelKey("xhigh")).toBe("thinkingLevels.xhigh");
		expect(thinkingLevelKey("low")).toBe("thinkingLevels.low");
		expect(thinkingLevelKey("ultra")).toBe("thinkingLevels.medium");
		expect(thinkingLevelKey("")).toBe("thinkingLevels.medium");
	});

	it("visibleThinkingLevels：按模型解锁档位裁剪（off 归一化为 none，不连号照样铺）", () => {
		expect(visibleThinkingLevels(["off", "minimal", "low", "medium", "high"])).toEqual([
			"none",
			"minimal",
			"low",
			"medium",
			"high",
		]);

		expect(visibleThinkingLevels(["off", "minimal", "low", "medium", "high", "xhigh", "max"])).toEqual([
			...THINKING_LEVELS,
		]);

		expect(visibleThinkingLevels(["off"])).toEqual(["none"]);

		expect(visibleThinkingLevels(["off", "high", "max"])).toEqual(["none", "high", "max"]);

		expect(visibleThinkingLevels(undefined)).toEqual([...THINKING_LEVELS]);
		expect(visibleThinkingLevels([])).toEqual([...THINKING_LEVELS]);
	});
});
