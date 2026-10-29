import { describe, expect, it } from "vitest";
import type { AnnotationPayload } from "./browserAnnotate";
import {
	annotationSkillCommand,
	buildPickerScript,
	candidateWorkspacePaths,
	elementLabel,
	splitAnnotationMessage,
} from "./browserAnnotate";

const payload: AnnotationPayload = {
	pageUrl: "http://localhost:5173/settings",
	note: "换成绿色",
	element: {
		tag: "button",
		id: "save",
		classes: ["primary", "shadow-sm"],
		selector: "button#save.primary",
		selectorMatches: 1,
		domPath: "html > body > main > form > button",
		text: "保存",
		html: '<button id="save" class="primary">保存</button>',
		attrs: { id: "save", "data-testid": "save-btn" },
		ancestor: { tag: "form", id: "", testid: "settings-form", classes: ["grid"] },
		styles: [
			{
				stylesheet: "http://localhost:5173/src/styles/globals.css",
				selector: ".primary",
				rule: ".primary { background: #7c3aed; }",
				candidateFiles: ["src/styles/globals.css"],
				verifiedFiles: ["src/styles/globals.css"],
			},
		],
		computed: { backgroundColor: "rgb(124, 58, 237)" },
		rect: { left: 12, top: 34, width: 80, height: 28 },
		viewport: { width: 462, height: 476 },
	},
};

describe("annotationSkillCommand", () => {
	it("产出 /skill:web-annotate 前缀 + 单行 JSON，JSON 可原样解析还原", () => {
		const command = annotationSkillCommand(payload);
		expect(command.startsWith("/skill:web-annotate ")).toBe(true);
		expect(command.includes("\n")).toBe(false);

		const json = command.slice("/skill:web-annotate ".length);
		const parsed = JSON.parse(json) as AnnotationPayload;
		expect(parsed.note).toBe("换成绿色");
		expect(parsed.element.selector).toBe("button#save.primary");
		expect(parsed.element.selectorMatches).toBe(1);
		expect(parsed.element.attrs["data-testid"]).toBe("save-btn");
		expect(parsed.element.ancestor?.testid).toBe("settings-form");
		expect(parsed.element.styles[0]?.verifiedFiles).toEqual(["src/styles/globals.css"]);
		expect(parsed.pageUrl).toBe("http://localhost:5173/settings");
	});
});

describe("candidateWorkspacePaths", () => {
	it("站点根路径 → 去掉 origin 与前导 / 的相对路径", () => {
		expect(candidateWorkspacePaths("http://localhost:5173/src/styles/globals.css")).toEqual([
			"src/styles/globals.css",
		]);
	});

	it("带查询串/锚点的 href 正常工作", () => {
		expect(candidateWorkspacePaths("http://localhost:5173/theme.css?v=2#x")).toEqual(["theme.css"]);
	});

	it("非 http(s)（file/inline null）不产生候选", () => {
		expect(candidateWorkspacePaths("file:///C:/t/a.css")).toEqual([]);
		expect(candidateWorkspacePaths("")).toEqual([]);
	});
});

describe("buildPickerScript", () => {
	it("脚本包含拾取/取消/清理的关键行为", () => {
		const script = buildPickerScript();
		expect(script).toContain("pointermove");
		expect(script).toContain("Escape");
		expect(script).toContain("__tcodePickerActive");
		expect(script).toContain("collect");
		expect(script).toContain("stripState");
		expect(script).toContain("CONTROL_SELECTOR");
		expect(script).toContain("e.altKey");
		expect(script).toContain("unreadable");
		expect(script).toContain("getPropertyValue(cssName)");
		expect(script).toContain("node.classList && node.classList.length");
		expect(script.startsWith("(() => {")).toBe(true);
		expect(script.endsWith("})()")).toBe(true);
	});

	it("脚本本身语法合法（模板里的反斜杠转义写错会整段炸掉，而 executeJavaScript 的报错很容易被忽略）", () => {
		expect(() => new Function(buildPickerScript())).not.toThrow();
	});

	it("选择器构造是转义 + 验唯一的那一版（不是旧的 tag+3个 class 硬拼）", () => {
		const script = buildPickerScript();
		expect(script).toContain("selectorMatches");
		expect(script).toContain("selectorFor");
		expect(script).toContain("CSS.escape");
		expect(script).toContain("attrsOf");
		expect(script).toContain("ancestorOf");

		expect(script).not.toContain("const describe = (el) =>");
	});

	it("兜底 DOM 路径含 body、id 处收锚（跳过 body 会让整条链命中 0 个元素）", () => {
		const script = buildPickerScript();
		expect(script).toContain("domPathOf");

		const domPath = script.slice(script.indexOf("const domPathOf"), script.indexOf("const selectorFor"));
		expect(domPath).toContain("node instanceof Element && node !== document.documentElement");
		expect(domPath).not.toContain("document.body");

		expect(domPath).toContain(
			'if (node.id) { chain.unshift("#" + esc(node.id)); return chain.join(" > "); }',
		);
	});

	it("标识性属性先于 class 成为候选（button[aria-label=…] 源码里搜得到，class 组合搜不到）", () => {
		const script = buildPickerScript();
		expect(script).toContain("quoteAttr");
		expect(script).toContain('["aria-label", "name", "title", "placeholder", "alt", "href"]');

		expect(script.indexOf('["aria-label"')).toBeLessThan(
			script.indexOf('candidates.push(tag + "." + dotted(classes))'),
		);
	});

	it("悬停/点击都会先收拢到可识别元素（否则图标按钮只会标到 <path>，属性全空、源码里找不到）", () => {
		const script = buildPickerScript();
		expect(script).toContain("meaningfulTarget");
		expect(script).toContain("SEMANTIC_TAGS");

		expect(script).toContain("meaningfulTarget(hit, e.altKey)");
		expect(script).toContain("meaningfulTarget(e.target, true)");

		expect(script).not.toContain("classList.length &&");
	});
});

describe("elementLabel", () => {
	it("tag + #id + 前 3 个 class + [data-testid]（多余的 class 不进标签）", () => {
		expect(
			elementLabel({
				tag: "button",
				id: "save",
				classes: ["primary", "shadow-sm", "rounded-md", "mt-2"],
				attrs: { "data-testid": "save-btn" },
			}),
		).toBe('button#save.primary.shadow-sm.rounded-md[data-testid="save-btn"]');
	});

	it("只有 tag、或整个元素缺失 → 不吐多余分隔符", () => {
		expect(elementLabel({ tag: "div" })).toBe("div");
		expect(elementLabel({ tag: "div", classes: [] })).toBe("div");
		expect(elementLabel({})).toBe("");
		expect(elementLabel(null)).toBe("");
		expect(elementLabel(undefined)).toBe("");
	});

	it("与拾取器悬停标签逐字一致（规则两边各有一份，改一边这条就红）", () => {
		const script = buildPickerScript();
		const source = script.slice(script.indexOf("const labelOf ="), script.indexOf("const countOf"));
		const pickerLabelOf = new Function(`${source}return labelOf;`)() as (el: unknown) => string;

		const el = {
			tagName: "SECTION",
			id: "",
			classList: ["hero", "is-dark", "p-4", "extra"],
			getAttribute: (name: string) => (name === "data-testid" ? "hero" : ""),
		};
		expect(pickerLabelOf(el)).toBe('section.hero.is-dark.p-4[data-testid="hero"]');
		expect(
			elementLabel({
				tag: "section",
				classes: ["hero", "is-dark", "p-4", "extra"],
				attrs: { "data-testid": "hero" },
			}),
		).toBe(pickerLabelOf(el));
	});
});

describe("splitAnnotationMessage", () => {
	const ann = (note: string) =>
		`/skill:web-annotate {"pageUrl":"http://127.0.0.1:8799/","element":{"tag":"div"},"note":"${note}"}`;

	it("带前缀的单条命令 → 一张卡片（含原始命令）", () => {
		expect(splitAnnotationMessage(ann("红"))).toEqual([
			{
				kind: "card",
				pageUrl: "http://127.0.0.1:8799/",
				note: "红",
				elementLabel: "div",
				command: ann("红"),
			},
		]);
	});

	it("行首裸 JSON（SDK 展开后只剩 args 的形态）→ 一张卡片", () => {
		expect(splitAnnotationMessage(`{"pageUrl":"http://x/","element":{},"note":"蓝"}`)).toEqual([
			{
				kind: "card",
				pageUrl: "http://x/",
				note: "蓝",
				elementLabel: "",
				command: `/skill:web-annotate {"pageUrl":"http://x/","element":{},"note":"蓝"}`,
			},
		]);
	});

	it("一条消息两条命令（裸 JSON + 带前缀，SDK 只展开第一条）→ 两张卡片", () => {
		const text = `{"pageUrl":"http://127.0.0.1:8799/","element":{"tag":"div"},"note":"换个颜色"}\n${ann("换个名称")}`;
		expect(splitAnnotationMessage(text)).toEqual([
			{
				kind: "card",
				pageUrl: "http://127.0.0.1:8799/",
				note: "换个颜色",
				elementLabel: "div",
				command: `/skill:web-annotate {"pageUrl":"http://127.0.0.1:8799/","element":{"tag":"div"},"note":"换个颜色"}`,
			},
			{
				kind: "card",
				pageUrl: "http://127.0.0.1:8799/",
				note: "换个名称",
				elementLabel: "div",
				command: ann("换个名称"),
			},
		]);
	});

	it("普通文本 + 命令混合 → 文本段与卡片段", () => {
		const text = `先改一下\n${ann("绿")}\n顺便再看看`;
		expect(splitAnnotationMessage(text)).toEqual([
			{ kind: "text", text: "先改一下" },
			{
				kind: "card",
				pageUrl: "http://127.0.0.1:8799/",
				note: "绿",
				elementLabel: "div",
				command: ann("绿"),
			},
			{ kind: "text", text: "顺便再看看" },
		]);
	});

	it("正文与命令之间的空行不进入文本气泡", () => {
		expect(splitAnnotationMessage(`重新设计\n\n${ann("红")}`)).toEqual([
			{ kind: "text", text: "重新设计" },
			{
				kind: "card",
				pageUrl: "http://127.0.0.1:8799/",
				note: "红",
				elementLabel: "div",
				command: ann("红"),
			},
		]);
	});

	it("纯文本 → 只有文本段", () => {
		expect(splitAnnotationMessage("你好世界")).toEqual([{ kind: "text", text: "你好世界" }]);
	});
});
