import { describe, expect, it } from "vitest";
import { ASK_ANSWER_SEPARATOR, composeAskAnswer } from "./ask-answer";

describe("composeAskAnswer：单选 / 多选 / 自定义三种来源拼成一个字符串", () => {
	it("单选：就是那一项（与旧行为完全一致）", () => {
		expect(composeAskAnswer(["方案 B"])).toBe("方案 B");
	});

	it("多选：按勾选顺序用「、」连接", () => {
		expect(composeAskAnswer(["Terminal", "Browser", "Diff"])).toBe(
			`Terminal${ASK_ANSWER_SEPARATOR}Browser${ASK_ANSWER_SEPARATOR}Diff`,
		);
	});

	it("自定义文本接在勾选项后面（多选时两者共存）", () => {
		expect(composeAskAnswer(["A", "B"], " 其他写法 ")).toBe(
			`A${ASK_ANSWER_SEPARATOR}B${ASK_ANSWER_SEPARATOR}其他写法`,
		);
	});

	it("只有自定义文本（开放问题）", () => {
		expect(composeAskAnswer([], "随便写点什么")).toBe("随便写点什么");
	});

	it("空 / 全空白 = 空串（提交按它判能不能点）", () => {
		expect(composeAskAnswer([])).toBe("");
		expect(composeAskAnswer([""], "   ")).toBe("");
	});

	it("去重：勾了 A 又在自定义里写了 A，不出现 A、A", () => {
		expect(composeAskAnswer(["A", "B"], "A")).toBe(`A${ASK_ANSWER_SEPARATOR}B`);
	});

	it("连接符就是模型那边约定的顿号", () => {
		expect(ASK_ANSWER_SEPARATOR).toBe("、");
	});
});
