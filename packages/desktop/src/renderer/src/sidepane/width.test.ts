import { SIDEPANE_MIN_WIDTH_PX } from "@tcode/shared";
import { describe, expect, it } from "vitest";
import { sidePaneMaxWidthPx } from "./width";

const CHAT_FLOOR = 427;

describe("sidePaneMaxWidthPx", () => {
	it("窗口够宽时按聊天列地板放开，不再被固定 720 卡住", () => {
		expect(sidePaneMaxWidthPx(1920, 280, CHAT_FLOOR)).toBe(1213);
		expect(sidePaneMaxWidthPx(1920, 280, CHAT_FLOOR)).toBeGreaterThan(720);

		expect(sidePaneMaxWidthPx(1920, 0, CHAT_FLOOR)).toBe(1280);
	});

	it("小窗口由聊天列地板封顶（拖宽不许挤破输入框）", () => {
		expect(sidePaneMaxWidthPx(900, 280, CHAT_FLOOR)).toBe(SIDEPANE_MIN_WIDTH_PX);
		expect(sidePaneMaxWidthPx(1200, 280, CHAT_FLOOR)).toBe(493);
	});

	it("地板还没测出来（0）时仍有视口 2/3 兜底，不会让 dock 吃满整窗", () => {
		expect(sidePaneMaxWidthPx(1920, 0, 0)).toBe(1280);
	});

	it("极窄视口退回最小宽度", () => {
		expect(sidePaneMaxWidthPx(600, 280, CHAT_FLOOR)).toBe(SIDEPANE_MIN_WIDTH_PX);
	});
});
