import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

process.env.PI_CODING_AGENT_DIR = join(tmpdir(), "tcode-ai-title-test-empty");

import {
	AI_TITLE_ANCHOR_MAX_CHARS,
	AI_TITLE_INPUT_MAX_CHARS,
	AI_TITLE_MAX_CHARS,
	type AiTitleAttempt,
	applyAiTitle,
	composeTitleInput,
	firstUserMessageText,
	generateAiTitle,
	messageStartText,
	repairMessageText,
	repairPrependRotated,
	sanitizeAiTitle,
	shouldTitleAgain,
	shouldTitleWithAi,
	userMessageTexts,
} from "../src/session/ai-title";
import { firstLineTitle, userMessageText } from "../src/session/naming";

function userMsg(text: string, type = "text"): AgentSessionEvent {
	return {
		type: "message_start",
		message: { role: "user", content: [{ type, text }] },
	} as unknown as AgentSessionEvent;
}

function entry(role: string, content: unknown): SessionEntry {
	return { type: "message", message: { role, content } } as unknown as SessionEntry;
}

describe("messageStartText / firstUserMessageText（起名输入提取）", () => {
	it("message_start 用户消息取全文", () => {
		expect(messageStartText(userMsg("帮我修复登录 bug"))).toBe("帮我修复登录 bug");
	});

	it("assistant 消息 / 非 message_start 事件 → undefined", () => {
		expect(
			messageStartText({
				type: "message_start",
				message: { role: "assistant", content: [{ type: "text", text: "你好" }] },
			} as unknown as AgentSessionEvent),
		).toBeUndefined();
		expect(messageStartText({ type: "agent_end" } as unknown as AgentSessionEvent)).toBeUndefined();
	});

	it("纯图片消息 → undefined（没有可总结的文本）", () => {
		expect(
			messageStartText({
				type: "message_start",
				message: { role: "user", content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] },
			} as unknown as AgentSessionEvent),
		).toBeUndefined();
	});

	it("分支首条用户消息：跳过 assistant / 非消息条目，取第一条 user", () => {
		const entries = [
			entry("assistant", [{ type: "text", text: "先说话" }]),
			entry("user", [{ type: "text", text: "你是什么模型" }]),
			entry("user", [{ type: "text", text: "第二条" }]),
		];
		expect(firstUserMessageText(entries)).toBe("你是什么模型");
		expect(firstUserMessageText([entry("assistant", "hi")])).toBeUndefined();
		expect(firstUserMessageText([])).toBeUndefined();
	});

	it("skill 展开还原口径与自动命名一致（/skill:name args）", () => {
		const xml =
			'<skill name="mindmap" location="/tmp/skills/mindmap/SKILL.md">\nReferences are relative to /tmp/skills/mindmap.\n\n# Mind map\n\nBody\n</skill>\n\n帮我画架构图\n细节补充';
		const text = messageStartText(userMsg(xml));
		expect(firstLineTitle(text ?? "")).toBe("/skill:mindmap 帮我画架构图");
	});
});

describe("userMessageTexts（全部用户消息，重试输入源）", () => {
	it("按序收集 user 文本，跳过 assistant / 无文本消息", () => {
		const entries = [
			entry("user", [{ type: "text", text: "第一条" }]),
			entry("assistant", [{ type: "text", text: "回答" }]),
			entry("user", [{ type: "image", data: "AAAA", mimeType: "image/png" }]),
			entry("user", [{ type: "text", text: " 第三条 " }]),
		];
		expect(userMessageTexts(entries)).toEqual(["第一条", "第三条"]);
		expect(userMessageTexts([])).toEqual([]);
		expect(userMessageTexts([entry("assistant", "hi")])).toEqual([]);
	});

	it("skill 展开还原口径与首行命名一致（/skill:name args）", () => {
		const xml =
			'<skill name="mindmap" location="/tmp/skills/mindmap/SKILL.md">\nReferences are relative to /tmp/skills/mindmap.\n\n# Mind map\n\nBody\n</skill>\n\n帮我画架构图';
		expect(userMessageTexts([entry("user", [{ type: "text", text: xml }])])).toEqual([
			"/skill:mindmap 帮我画架构图",
		]);
	});
});

describe("shouldTitleWithAi（守卫）", () => {
	it("名字为空 / 等于首行自动名 → 允许", () => {
		expect(shouldTitleWithAi({ messageText: "帮我修 bug", currentName: undefined })).toBe(true);
		expect(shouldTitleWithAi({ messageText: "帮我修 bug\n细节", currentName: "帮我修 bug" })).toBe(true);
	});

	it("名字不是首行自动名（用户手动改过）→ 拦截", () => {
		expect(shouldTitleWithAi({ messageText: "hi", currentName: "OS" })).toBe(false);
	});

	it("无文本 / 只读子会话 → 拦截", () => {
		expect(shouldTitleWithAi({ messageText: undefined, currentName: undefined })).toBe(false);
		expect(shouldTitleWithAi({ messageText: "hi", currentName: undefined, readOnly: true })).toBe(false);
	});
});

describe("shouldTitleAgain（失败重试，成功后不再更新）", () => {
	const base: AiTitleAttempt = {
		status: "failed",
		userTexts: ["继续"],
		expectedName: "继续",
		attempts: 1,
	};

	it("前次失败 + 名字未被手动改过 → 允许；空名会话（两 undefined）→ 允许", () => {
		expect(shouldTitleAgain({ state: base, currentName: "继续" })).toBe(true);
		expect(shouldTitleAgain({ state: { ...base, expectedName: undefined }, currentName: undefined })).toBe(
			true,
		);
	});

	it("done → 拦截（名字定住，不再更新）", () => {
		const done = { ...base, status: "done" as const, expectedName: "修复登录 bug" };
		expect(shouldTitleAgain({ state: done, currentName: "修复登录 bug" })).toBe(false);
	});

	it("不限次数：attempts 再大也允许（锁住不设上限的决定）", () => {
		expect(shouldTitleAgain({ state: { ...base, attempts: 99 }, currentName: "继续" })).toBe(true);
	});

	it("in-flight → 拦截（单飞）", () => {
		expect(shouldTitleAgain({ state: { ...base, status: "in-flight" }, currentName: "继续" })).toBe(false);
	});

	it("名字被手动改过 / 只读 / 无记账 → 拦截", () => {
		expect(shouldTitleAgain({ state: base, currentName: "我改的名" })).toBe(false);
		expect(shouldTitleAgain({ state: base, currentName: "继续", readOnly: true })).toBe(false);
		expect(shouldTitleAgain({ state: undefined, currentName: undefined })).toBe(false);
	});
});

describe("sanitizeAiTitle（清洗）", () => {
	it("剥包裹引号（中英文）与「标题：」前缀", () => {
		expect(sanitizeAiTitle("「询问模型能力」", "zh")).toBe("询问模型能力");
		expect(sanitizeAiTitle('"修复登录 bug"', "zh")).toBe("修复登录 bug");
		expect(sanitizeAiTitle("标题：修复登录 bug。", "zh")).toBe("修复登录 bug");
	});

	it("只取首行，并去掉结尾标点", () => {
		expect(sanitizeAiTitle("修复登录 bug\n（补充说明）", "zh")).toBe("修复登录 bug");
		expect(sanitizeAiTitle("修复登录 bug！！", "zh")).toBe("修复登录 bug");
	});

	it("超过上限硬截断（中 24 字 / 英 36 字符）", () => {
		const title = sanitizeAiTitle("这是一个非常非常非常非常非常非常长的会话标题内容示例文字", "zh");
		expect(title).toHaveLength(AI_TITLE_MAX_CHARS.zh);
		const long = sanitizeAiTitle("a".repeat(60), "en");
		expect(long).toHaveLength(AI_TITLE_MAX_CHARS.en);
	});

	it("英文超限退到词边界并剥挂尾连接词；没有词边界（单长词）就硬截", () => {
		expect(sanitizeAiTitle("Acme model capabilities and permissions", "en")).toBe("Acme model capabilities");
		expect(sanitizeAiTitle(`a ${"b".repeat(50)}`, "en")).toHaveLength(AI_TITLE_MAX_CHARS.en);
	});

	it("空白 / 只有引号 → undefined", () => {
		expect(sanitizeAiTitle("   \n  ", "zh")).toBeUndefined();
		expect(sanitizeAiTitle("''", "zh")).toBeUndefined();
	});
});

describe("repairPrependRotated / repairMessageText", () => {
	it("单字符错位（s）：快照首字符挪回末尾", () => {
		expect(
			repairPrependRotated("sModel capabilities and permission", "Model capabilities and permission"),
		).toBe("Model capabilities and permissions");
		expect(repairPrependRotated("sCode error analysi", "Code error analysi")).toBe("Code error analysis");
	});

	it("双字符错位（st）与中文消息里的 ASCII 尾词", () => {
		expect(repairPrependRotated("stAutumn essay reque", "Autumn essay reque")).toBe("Autumn essay request");
		expect(repairPrependRotated("g修复登录 bu", "修复登录 bu")).toBe("修复登录 bug");
	});

	it("正常（快照 === 累加）或对不上 → 原样返回", () => {
		expect(repairPrependRotated("Fix login bug", "Fix login bug")).toBe("Fix login bug");
		expect(repairPrependRotated("zabc", "abd")).toBe("zabc");
	});

	it("命中时文本块替换为修复文本、thinking 块原样保留；未命中返回原对象", () => {
		const message = {
			content: [
				{ type: "thinking", thinking: "想法" },
				{ type: "text", text: "sModel capabilities and permission" },
			],
		} as unknown as AssistantMessage;
		const repaired = repairMessageText(message, "Model capabilities and permission");
		expect(repaired.content).toEqual([
			{ type: "thinking", thinking: "想法" },
			{ type: "text", text: "Model capabilities and permissions" },
		]);
		const clean = { content: [{ type: "text", text: "Fix login bug" }] } as unknown as AssistantMessage;
		expect(repairMessageText(clean, "Fix login bug")).toBe(clean);
	});
});

describe("composeTitleInput（输入定稿：全量优先，超预算压头尾）", () => {
	it("全部装得下 → 按序全量拼接", () => {
		expect(composeTitleInput(["继续", "修复登录 bug", "补个测试"])).toBe("继续\n\n修复登录 bug\n\n补个测试");
	});

	it("单条超长 → 直接截到预算（不做头尾压缩）", () => {
		expect(composeTitleInput(["x".repeat(900)])).toHaveLength(AI_TITLE_INPUT_MAX_CHARS);
	});

	it("超预算 → 首条截锚点 + 省略号 + 最新条（总长 ≤ 预算，中间省略）", () => {
		const out = composeTitleInput(["锚".repeat(800), "中".repeat(800), "最".repeat(800)]);
		const tailLen = AI_TITLE_INPUT_MAX_CHARS - AI_TITLE_ANCHOR_MAX_CHARS - "\n\n……\n\n".length;
		expect(out).toBe(`${"锚".repeat(AI_TITLE_ANCHOR_MAX_CHARS)}\n\n……\n\n${"最".repeat(tailLen)}`);
		expect(out).not.toContain("中");
	});

	it("尾部能装多条就装多条（最新优先、整条并入）", () => {
		const out = composeTitleInput(["锚".repeat(300), "甲".repeat(100), "乙".repeat(120), "丙".repeat(150)]);
		expect(out).toBe(
			`${"锚".repeat(AI_TITLE_ANCHOR_MAX_CHARS)}\n\n……\n\n${"甲".repeat(100)}\n\n${"乙".repeat(120)}\n\n${"丙".repeat(150)}`,
		);
		expect(out.length).toBeLessThanOrEqual(AI_TITLE_INPUT_MAX_CHARS);
	});

	it("空输入 → 空串", () => {
		expect(composeTitleInput([])).toBe("");
	});
});

describe("generateAiTitle（编排）", () => {
	const model = {} as Model<any>;

	it("调模型 → 清洗出最终标题；提示词带 24 字要求、输入截断 600", async () => {
		const requests: Array<{ systemPrompt: string; prompt: string }> = [];
		const title = await generateAiTitle(model, "x".repeat(900), "zh", {
			complete: async (_model, request) => {
				requests.push(request);
				return { content: [{ type: "text", text: "「询问模型能力」" }] } as unknown as AssistantMessage;
			},
		});
		expect(title).toBe("询问模型能力");
		expect(requests[0]?.systemPrompt).toContain(String(AI_TITLE_MAX_CHARS.zh));
		expect(requests[0]?.systemPrompt).toContain("与消息同语言");

		expect(requests[0]?.systemPrompt).toContain("一条或多条");
		expect(requests[0]?.prompt).toHaveLength(AI_TITLE_INPUT_MAX_CHARS);
	});

	it("英文界面：用英文提示词（要求英文 + 36 字符上限）", async () => {
		const requests: Array<{ systemPrompt: string; prompt: string }> = [];
		const title = await generateAiTitle(model, "帮我修登录 bug", "en", {
			complete: async (_model, request) => {
				requests.push(request);
				return { content: [{ type: "text", text: "Fix login bug" }] } as unknown as AssistantMessage;
			},
		});
		expect(title).toBe("Fix login bug");
		expect(requests[0]?.systemPrompt).toContain("in English");
		expect(requests[0]?.systemPrompt).toContain(String(AI_TITLE_MAX_CHARS.en));
		expect(requests[0]?.systemPrompt).toContain("3-6 words");
		expect(requests[0]?.systemPrompt).toContain("message(s)");

		expect(title).not.toMatch(/[\u4e00-\u9fa5]/);
	});

	it("模型输出为空 → undefined；模型失败 / 超时 → 抛出（调用方记日志并保留原名）", async () => {
		await expect(
			generateAiTitle(model, "hi", "zh", {
				complete: async () => ({ content: [] }) as unknown as AssistantMessage,
			}),
		).resolves.toBeUndefined();
		await expect(
			generateAiTitle(model, "hi", "zh", {
				complete: async () => {
					throw new Error("provider 500");
				},
			}),
		).rejects.toThrow("provider 500");
		await expect(
			generateAiTitle(model, "hi", "zh", {
				complete: () => new Promise<AssistantMessage>(() => {}),
				timeoutMs: 25,
			}),
		).rejects.toThrow(/timeout/);
	});
});

describe("applyAiTitle（写回 + 竞态复检）", () => {
	function makeSession(name: string | undefined) {
		const calls: string[] = [];
		const session = {
			get sessionName() {
				return name;
			},
			setSessionName: (next: string) => {
				calls.push(next);
			},
		};
		return { session: session as unknown as Pick<AgentSession, "sessionName" | "setSessionName">, calls };
	}

	it("名字未变 → 写入", () => {
		const { session, calls } = makeSession("你是什么模型");
		expect(
			applyAiTitle({ session, expectedName: "你是什么模型", title: "询问模型能力", isAlive: () => true }),
		).toBe(true);
		expect(calls).toEqual(["询问模型能力"]);
	});

	it("中途被手动改名 / 会话已关闭 / 标题与原名相同 → 丢弃", () => {
		const renamed = makeSession("我改的名");
		expect(
			applyAiTitle({
				session: renamed.session,
				expectedName: "你是什么模型",
				title: "X",
				isAlive: () => true,
			}),
		).toBe(false);
		expect(renamed.calls).toEqual([]);
		const dead = makeSession("你是什么模型");
		expect(
			applyAiTitle({ session: dead.session, expectedName: "你是什么模型", title: "X", isAlive: () => false }),
		).toBe(false);
		expect(dead.calls).toEqual([]);
		const same = makeSession("hi");
		expect(
			applyAiTitle({ session: same.session, expectedName: "hi", title: "hi", isAlive: () => true }),
		).toBe(false);
		expect(same.calls).toEqual([]);
	});

	it("空名会话（纯图片首消息后补文本）也能被命名", () => {
		const { session, calls } = makeSession(undefined);
		expect(applyAiTitle({ session, expectedName: undefined, title: "打招呼", isAlive: () => true })).toBe(
			true,
		);
		expect(calls).toEqual(["打招呼"]);
	});
});

describe("userMessageText / firstLineTitle（与自动命名共用口径的导出）", () => {
	it("普通文本透传；超 30 字截断加省略号", () => {
		expect(userMessageText("你好")).toBe("你好");
		const long = "这是一个非常非常长的标题它一定会超过三十个字符的限制所以应该被截断";
		const title = firstLineTitle(long);
		expect(title).toHaveLength(31);
		expect(title?.endsWith("…")).toBe(true);
	});
});
