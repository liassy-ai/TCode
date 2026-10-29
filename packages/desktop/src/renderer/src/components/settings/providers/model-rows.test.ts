import { describe, expect, it } from "vitest";
import {
	defaultLevelFields,
	EMPTY_MODEL_ROW,
	emptyLevelFields,
	formatTokenCount,
	type ModelRow,
	modelsToRows,
	newModelRow,
	parseTokenCount,
	rowsToModelInputs,
	rowsValid,
	splitPastedModelIds,
} from "./model-rows";

const row = (over: Partial<ModelRow>): ModelRow => ({ ...EMPTY_MODEL_ROW, ...over });

describe("parseTokenCount", () => {
	it("解析裸数字与 k 后缀", () => {
		expect(parseTokenCount("256000")).toBe(256000);
		expect(parseTokenCount("256k")).toBe(256000);
		expect(parseTokenCount("128K")).toBe(128000);
		expect(parseTokenCount(" 16k ")).toBe(16000);
		expect(parseTokenCount("1.5k")).toBe(1500);
	});

	it("拒绝非法输入", () => {
		expect(parseTokenCount("abc")).toBeNull();
		expect(parseTokenCount("0")).toBeNull();
		expect(parseTokenCount("-5")).toBeNull();
		expect(parseTokenCount("1.5")).toBeNull();
		expect(parseTokenCount("0.0001k")).toBeNull();
		expect(parseTokenCount("")).toBeNull();
	});
});

describe("formatTokenCount", () => {
	it("整千折叠为 k，其余原样", () => {
		expect(formatTokenCount(256000)).toBe("256k");
		expect(formatTokenCount(128000)).toBe("128k");
		expect(formatTokenCount(999)).toBe("999");
		expect(formatTokenCount(65536)).toBe("65536");
	});
});

describe("rowsValid / rowsToModelInputs", () => {
	it("全空行合法：模型列表留空 = 沿用内置模型列表（仅覆写 baseUrl）", () => {
		expect(rowsValid([row({})])).toBe(true);
		expect(rowsValid([row({}), row({})])).toBe(true);
		expect(rowsValid([row({ id: "gpt-5" })])).toBe(true);
	});

	it("全空行转换为空数组（不落盘 models 键）", () => {
		expect(rowsToModelInputs([row({})])).toEqual([]);
	});

	it("ctx/out 留空合法，非法值不合法", () => {
		expect(rowsValid([row({ id: "m1", contextWindow: "abc" })])).toBe(false);
		expect(rowsValid([row({ id: "m1", contextWindow: "256k", maxTokens: "64k" })])).toBe(true);
	});

	it("转换时丢弃空行；空格位写 null（该档隐藏）", () => {
		const inputs = rowsToModelInputs([
			row({ id: " gpt-5.6-terra ", contextWindow: "256k", reasoning: true, imageInput: true }),
			row({}),
			row({ id: "gpt-5-mini", maxTokens: "16k" }),
		]);
		expect(inputs).toEqual([
			{
				id: "gpt-5.6-terra",
				reasoning: true,
				contextWindow: 256000,
				maxTokens: undefined,
				imageInput: true,
				thinkingLevelMap: { low: null, medium: null, high: null, xhigh: null, max: null },
			},
			{
				id: "gpt-5-mini",
				reasoning: undefined,
				contextWindow: undefined,
				maxTokens: 16000,
				imageInput: undefined,
			},
		]);
	});

	it("空格位写 null（SDK 视为不支持）；填了的值照常落盘；关闭思考不写映射", () => {
		const map = (levels: ModelRow["levels"]) =>
			rowsToModelInputs([row({ id: "m", reasoning: true, levels })])[0]?.thinkingLevelMap;

		expect(map(emptyLevelFields())).toEqual({ low: null, medium: null, high: null, xhigh: null, max: null });
		expect(map({ ...emptyLevelFields(), xhigh: " xhigh " })).toEqual({
			low: null,
			medium: null,
			high: null,
			xhigh: "xhigh",
			max: null,
		});
		expect(map({ ...emptyLevelFields(), medium: "low", high: "high" })).toEqual({
			low: null,
			medium: "low",
			high: "high",
			xhigh: null,
			max: null,
		});

		expect(
			rowsToModelInputs([row({ id: "m", levels: { ...emptyLevelFields(), xhigh: "xhigh" } })])[0]
				?.thinkingLevelMap,
		).toBeUndefined();
	});
});

describe("modelsToRows", () => {
	it("从 ProviderInfo.models 预填，缺省档位回填为可见默认，显式 null 保持隐藏", () => {
		expect(
			modelsToRows([
				{ id: "a", name: "a", reasoning: true, contextWindow: 256000 },
				{ id: "b", name: "b" },
			]),
		).toEqual([
			row({ id: "a", contextWindow: "256k", reasoning: true, levels: defaultLevelFields() }),
			row({ id: "b", levels: defaultLevelFields() }),
		]);
		expect(
			modelsToRows([{ id: "c", reasoning: true, thinkingLevelMap: { medium: null } }])[0]?.levels,
		).toEqual({
			...defaultLevelFields(),
			medium: "",
		});
	});

	it("已落盘的 thinkingLevelMap 回填到行（编辑不丢档位映射，可自定义档都认）", () => {
		expect(modelsToRows([{ id: "a", reasoning: true, thinkingLevelMap: { max: "max" } }])).toEqual([
			row({ id: "a", reasoning: true, levels: { ...defaultLevelFields(), max: "max" } }),
		]);
		expect(
			modelsToRows([{ id: "b", reasoning: true, thinkingLevelMap: { medium: "low", high: "high" } }])[0]
				?.levels,
		).toEqual({ ...defaultLevelFields(), medium: "low", high: "high" });
	});

	it("每行都有自己的 levels 对象（新增行不共享同一份，改一行不会串到其它行）", () => {
		const a = newModelRow({ id: "a" });
		const b = newModelRow({ id: "b" });
		expect(a.levels).not.toBe(b.levels);
		expect(modelsToRows([])[0]?.levels).not.toBe(EMPTY_MODEL_ROW.levels);
	});

	it("新增行默认可见 low/medium/high，xhigh/max 留空即隐藏", () => {
		expect(newModelRow().levels).toEqual(defaultLevelFields());
		expect(rowsToModelInputs([newModelRow({ id: "m", reasoning: true })])[0]?.thinkingLevelMap).toEqual({
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null,
		});
	});

	it("空列表兜底一个空行", () => {
		expect(modelsToRows([])).toEqual([row({})]);
	});
});

describe("splitPastedModelIds", () => {
	it("逗号/换行拆分，普通文本返回 null", () => {
		expect(splitPastedModelIds("gpt-5, gpt-5-mini\ngpt-5-nano")).toEqual([
			"gpt-5",
			"gpt-5-mini",
			"gpt-5-nano",
		]);
		expect(splitPastedModelIds("gpt-5")).toBeNull();
		expect(splitPastedModelIds(",,\n")).toBeNull();
	});
});
