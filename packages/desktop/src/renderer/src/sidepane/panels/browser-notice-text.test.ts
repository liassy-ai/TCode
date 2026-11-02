import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
	vi.stubGlobal("navigator", { language: "zh-CN" });
});

import { type Language, type Translate, translate } from "../../i18n";
import { controlNoticeText } from "../browser-notice-text";

const t =
	(language: Language = "zh"): Translate =>
	(key, params) =>
		translate(language, key, params);

describe("controlNoticeText：带动作名的徽标文案", () => {
	it("resize 说「调整视口」，进行中 / 刚做完两态都对", () => {
		expect(controlNoticeText(t(), { tabId: "t", status: "active", mode: "act", op: "resize" })).toBe(
			"AI 正在调整视口…",
		);
		expect(controlNoticeText(t(), { tabId: "t", status: "done", mode: "act", op: "resize" })).toBe(
			"AI 刚刚调整视口",
		);
	});

	it("测量/截图/刷新/点击各自的说法", () => {
		const text = (op: string) => controlNoticeText(t(), { tabId: "t", status: "active", mode: "act", op });
		expect(text("script")).toBe("AI 正在测量页面…");
		expect(text("screenshot")).toBe("AI 正在截图…");
		expect(text("reload")).toBe("AI 正在刷新页面…");
		expect(text("click")).toBe("AI 正在点击元素…");
	});

	it("拿不到 op（wait / console / cdp / close）退回通用文案，不编动作名", () => {
		expect(controlNoticeText(t(), { tabId: "t", status: "active", mode: "act", op: "cdp" })).toBe(
			"AI 正在操作此页面…",
		);
		expect(controlNoticeText(t(), { tabId: "t", status: "active", mode: "act" })).toBe("AI 正在操作此页面…");
		expect(controlNoticeText(t(), { tabId: "t", status: "done", mode: "act", op: "console" })).toBe(
			"AI 刚刚操作了此页面",
		);
	});

	it("view（read / list）保持「查看此页面」，不改成动作名", () => {
		expect(controlNoticeText(t(), { tabId: "t", status: "active", mode: "view", op: "read" })).toBe(
			"AI 正在查看此页面…",
		);
		expect(controlNoticeText(t(), { tabId: "t", status: "done", mode: "view", op: "list" })).toBe(
			"AI 刚刚查看了此页面",
		);
	});

	it("英文包同形（act 短语是动名词，两个模板都读得通）", () => {
		expect(controlNoticeText(t("en"), { tabId: "t", status: "active", mode: "act", op: "script" })).toBe(
			"AI is measuring the page…",
		);
		expect(controlNoticeText(t("en"), { tabId: "t", status: "done", mode: "act", op: "script" })).toBe(
			"AI just finished measuring the page",
		);
	});
});
