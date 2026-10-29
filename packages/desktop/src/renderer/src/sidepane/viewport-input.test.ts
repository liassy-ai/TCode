import { describe, expect, it } from "vitest";
import {
	formatPercent,
	parseViewportSize,
	resolveViewportSize,
	VIEWPORT_MAX_PX,
	VIEWPORT_MIN_PX,
} from "./viewport-input";

describe("视口输入：尺寸解析", () => {
	it("整数照收，小数四舍五入", () => {
		expect(parseViewportSize("1280")).toBe(1280);
		expect(parseViewportSize(" 800 ")).toBe(800);
		expect(parseViewportSize("1280.6")).toBe(1281);
	});

	it("空 / 非法回 null（调用方沿用当前值，不当成 0）", () => {
		expect(parseViewportSize("")).toBeNull();
		expect(parseViewportSize("   ")).toBeNull();
		expect(parseViewportSize("abc")).toBeNull();
		expect(parseViewportSize("1280px")).toBe(1280);
	});

	it("越界夹到区间内（太小没意义，太大 CDP 也接不住）", () => {
		expect(parseViewportSize("-100")).toBe(VIEWPORT_MIN_PX);
		expect(parseViewportSize("999999")).toBe(VIEWPORT_MAX_PX);
	});
});

describe("视口输入：比例显示文本", () => {
	it("比例取整成百分数（0.364 → 36，1 → 100）", () => {
		expect(formatPercent(1)).toBe("100");
		expect(formatPercent(0.364)).toBe("36");
		expect(formatPercent(1.5)).toBe("150");
	});

	it("极端值也夹在 5%–1000%（下拉不可能给出这种值，兜住脏状态）", () => {
		expect(formatPercent(0)).toBe("5");
		expect(formatPercent(99)).toBe("1000");
	});
});

describe("视口输入：应用时的归一", () => {
	const current = { width: 1024, height: 768 };

	it("两个框都有值 → 全用输入值", () => {
		expect(resolveViewportSize({ width: "1280", height: "800" }, current)).toEqual({
			width: 1280,
			height: 800,
		});
	});

	it("空 / 非法项沿用当前值（清空一个框不会把窗口搞崩）", () => {
		expect(resolveViewportSize({ width: "", height: "800" }, current)).toEqual({
			width: 1024,
			height: 800,
		});
		expect(resolveViewportSize({ width: "1280", height: "" }, current)).toEqual({
			width: 1280,
			height: 768,
		});
	});

	it("乱填也不报错：整行沿用当前值", () => {
		expect(resolveViewportSize({ width: "x", height: "y" }, current)).toEqual(current);
	});

	it("越界值夹到区间内再应用", () => {
		expect(resolveViewportSize({ width: "10", height: "999999" }, current)).toEqual({
			width: VIEWPORT_MIN_PX,
			height: VIEWPORT_MAX_PX,
		});
	});
});
