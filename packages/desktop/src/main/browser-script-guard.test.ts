import { describe, expect, it } from "vitest";
import { findScriptPointerViolation, scriptPointerRejection } from "./browser-script-guard";

describe("findScriptPointerViolation：挡住 script 里的页面操作", () => {
	it("点击：.click()", () => {
		expect(findScriptPointerViolation("document.querySelector('#go').click()")?.instead).toContain("click");
	});

	it("滚动：scrollIntoView / scrollTo / scrollBy / scrollTop 赋值", () => {
		for (const code of [
			"document.getElementById('cases').scrollIntoView({block:'start'})",
			"window.scrollTo(0, 1200)",
			"window.scrollBy(0, 400)",
			"el.scrollTop = 300",
		]) {
			expect(findScriptPointerViolation(code)?.instead, code).toContain("scroll");
		}
	});

	it("填值：.value =（但不误伤 === 比较）", () => {
		expect(findScriptPointerViolation("input.value = 'abc'")?.instead).toContain("type");
		expect(findScriptPointerViolation("return input.value === 'abc'")).toBeNull();
	});

	it("事件：dispatchEvent / new MouseEvent / KeyboardEvent", () => {
		for (const code of [
			"el.dispatchEvent(new Event('change'))",
			"el.dispatchEvent(new MouseEvent('click'))",
			"el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}))",
		]) {
			expect(findScriptPointerViolation(code), code).not.toBeNull();
		}
	});

	it("表单提交：submit() / requestSubmit()", () => {
		expect(findScriptPointerViolation("form.requestSubmit()")?.instead).toContain("submit");
		expect(findScriptPointerViolation("form.submit()")?.instead).toContain("submit");
	});

	it("纯读取 / 测量一律放行（这是 script 的本职）", () => {
		for (const code of [
			"return document.title",
			"const h = document.querySelector('h1'); return getComputedStyle(h).fontFamily",
			"return JSON.stringify({cases: document.querySelectorAll('.case').length})",
			"return document.querySelector('#popupMask').classList.contains('show')",
			"return window.scrollY",
			"const b = el.getBoundingClientRect(); return b.height",
			"el.focus(); return document.activeElement === el",
		]) {
			expect(findScriptPointerViolation(code), code).toBeNull();
		}
	});

	it("拒绝文案同时给出「哪一处」和「改用什么」", () => {
		const v = findScriptPointerViolation("document.getElementById('milestones').scrollIntoView(); return 1");
		expect(v).not.toBeNull();
		const text = scriptPointerRejection(v as NonNullable<typeof v>);
		expect(text).toContain("scrollIntoView(");
		expect(text).toContain("改用内置 action：scroll");

		expect(text).not.toContain("用户看不到");
	});
});
