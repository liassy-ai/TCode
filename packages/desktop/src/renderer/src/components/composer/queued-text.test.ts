import { describe, expect, it } from "vitest";
import { collapsedQueuedText, queuedIsAnnotation, queuedPreview, splitQueuedForDraft } from "./queued-text";

const expanded = (name: string, location: string, referencesRoot: string, body: string, args?: string) =>
	`<skill name="${name}" location="${location}">\nReferences are relative to ${referencesRoot}.\n\n${body}\n</skill>${args ? `\n\n${args}` : ""}`;

const annotationArgs = JSON.stringify({
	pageUrl: "http://127.0.0.1:8080/#faq",
	element: { tag: "div", classes: ["mock-body"], selector: "div.mock-body" },
	note: "这首是什么元素",
});

const expandedAnnotation = expanded(
	"web-annotate",
	"C:\\Users\\A\\.pi\\agent-dev\\skills\\web-annotate.md",
	"C:\\Users\\A\\.pi\\agent-dev\\skills",
	"# 网页标注 → 定位源码\n\n用户在浏览器面板标注了一个元素。",
	annotationArgs,
);

describe("collapsedQueuedText", () => {
	it("展开态还原成可复用命令，技能正文不进输入框", () => {
		const out = collapsedQueuedText(expandedAnnotation);
		expect(out).toBe(`/skill:web-annotate ${annotationArgs}`);
		expect(out).not.toContain("References are relative to");
		expect(out).not.toContain("网页标注 → 定位源码");
	});

	it("非标注技能同样还原（不带参数时没有尾随空格）", () => {
		expect(
			collapsedQueuedText(
				expanded("mindmap", "/tmp/skills/mindmap/SKILL.md", "/tmp/skills/mindmap", "# Mind map\n\nBody"),
			),
		).toBe("/skill:mindmap");
		expect(
			collapsedQueuedText(
				expanded("mindmap", "/tmp/skills/mindmap/SKILL.md", "/tmp/skills/mindmap", "Body", "做一张图"),
			),
		).toBe("/skill:mindmap 做一张图");
	});

	it("普通文本 / 已经是命令的文本原样返回", () => {
		expect(collapsedQueuedText("随便一句话")).toBe("随便一句话");
		expect(collapsedQueuedText("/skill:web-annotate {}")).toBe("/skill:web-annotate {}");
	});
});

describe("queuedPreview", () => {
	it("标注命令 → 「网页标注 · 备注」（与会话气泡胶囊一致），不出现 JSON", () => {
		const out = queuedPreview(expandedAnnotation, "网页标注");
		expect(out).toBe("网页标注 · 这首是什么元素");
		expect(out).not.toContain("pageUrl");
	});

	it("标注命令没写备注时只给标签", () => {
		const noNote = expanded(
			"web-annotate",
			"/tmp/skills/web-annotate.md",
			"/tmp/skills",
			"正文",
			JSON.stringify({ pageUrl: "http://x/", element: { tag: "div" }, note: "" }),
		);
		expect(queuedPreview(noNote, "网页标注")).toBe("网页标注");
	});

	it("其他技能 → /skill:名字 参数；普通文本原样", () => {
		expect(
			queuedPreview(
				expanded("mindmap", "/tmp/skills/mindmap/SKILL.md", "/tmp/skills/mindmap", "Body", "画个图"),
				"网页标注",
			),
		).toBe("/skill:mindmap 画个图");
		expect(queuedPreview("先改颜色", "网页标注")).toBe("先改颜色");
	});
});

describe("queuedIsAnnotation", () => {
	it("标注命令（展开态与裸命令）都为真——排队条据此挂魔法棒图标", () => {
		expect(queuedIsAnnotation(expandedAnnotation)).toBe(true);
		expect(queuedIsAnnotation(`/skill:web-annotate ${annotationArgs}`)).toBe(true);
	});

	it("其他技能与普通文本为假", () => {
		expect(
			queuedIsAnnotation(expanded("mindmap", "/tmp/skills/mindmap/SKILL.md", "/tmp/skills/mindmap", "Body")),
		).toBe(false);
		expect(queuedIsAnnotation("先改颜色")).toBe(false);
	});
});

describe("splitQueuedForDraft", () => {
	it("标注命令进胶囊清单，不进正文（取回后不该看到 /skill:… 原文）", () => {
		expect(splitQueuedForDraft([expandedAnnotation])).toEqual({
			text: "",
			commands: [`/skill:web-annotate ${annotationArgs}`],
		});
	});

	it("标注 + 正文混排：各自归位", () => {
		const mixed = `${expandedAnnotation}\n\n顺便把标题也改一下`;
		expect(splitQueuedForDraft([mixed])).toEqual({
			text: "顺便把标题也改一下",
			commands: [`/skill:web-annotate ${annotationArgs}`],
		});
	});

	it("普通文本全部进正文，多条之间换行拼接", () => {
		expect(splitQueuedForDraft(["第一句", "第二句"])).toEqual({ text: "第一句\n第二句", commands: [] });
	});

	it("非标注技能进正文（它不是胶囊）", () => {
		const raw = expanded("mindmap", "/tmp/skills/mindmap/SKILL.md", "/tmp/skills/mindmap", "Body", "画个图");
		expect(splitQueuedForDraft([raw])).toEqual({ text: "/skill:mindmap 画个图", commands: [] });
	});
});
