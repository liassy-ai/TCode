import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SEEDED_BUILTIN_SKILLS } from "@tcode/backend";

const WEB_ANNOTATE_SKILL = `---
name: web-annotate
description: "网页元素标注 → 定位并修改项目里对应的样式。用户在浏览器面板标注元素并写备注后调用；参数是一段 JSON。"
---

# 网页标注 → 定位源码

用户在浏览器面板标注了一个元素并写了备注，参数为一段 JSON。

## 字段
- pageUrl：页面地址。
- note：用户备注。
- element：被标注的元素。落点已收拢到最近的可识别元素。
  - selector / selectorMatches：selector 在页面上的命中数，**等于 1 才是可信的唯一选择器**；大于 1 命中多个元素，仅作弱线索；小于 1 表示选择器非法或取不到。可信时优先形如 button[aria-label="…"] 的属性选择器而非 class 连写。
  - attrs：元素的标识性属性（data-testid、id、name、href、aria-label、title、placeholder、alt、data-* 等），**源码搜索的首选线索**。
  - classes：元素的类名，源码中为**空格分隔的 className 字符串**。
  - text / html：可见文本与 outerHTML 片段。
  - ancestor：最近一层带 id / data-testid 的祖先。
  - domPath：完整 DOM 路径（含 nth-of-type），兜底用。
- styles：命中的样式数组。selector 是命中该元素的 CSS 规则选择器，rule 是规则文本，group 说明它位于哪个 @media / @supports / @layer；stylesheet 为 null 表示样式由运行时注入，**没有对应文件可打开**。verifiedFiles 是确认存在的项目内路径，candidateFiles 是未验证的候选。
- computed：改动前的计算样式。

## 步骤
1. 解析 JSON，读 pageUrl、element、note。
2. 看 element.selectorMatches：等于 1 才可直接使用该 selector；大于 1 或为负时禁止作为定位依据，改走第 3 步。
3. 定位源码，按可靠度依次使用：
   a. element.attrs 中的属性值（data-testid / id / name / href / aria-label / title / placeholder / alt）：直接搜索；
   b. element.text 中的文案：先搜该字符串找到 i18n 词条（如 zh.ts 的 annotateNeedsPage），再搜词条名落到组件文件；
   c. element.classes：源码中为空格分隔，禁止用点号连写形态搜索；
   d. element.ancestor：先用其 data-testid / id 收窄到组件文件，再按上述线索查找。
4. 样式类问题（note 涉及颜色、间距等）：优先打开 styles[].verifiedFiles，用 styles[].selector 搜规则；stylesheet 为 null 时改走第 3 步。规则位于 @media / @supports / @layer 时用 group 判断上下文。
5. candidateFiles 仅在 verifiedFiles 为空时使用。
6. 命中多个候选，或只剩弱线索（selectorMatches > 1、仅有单个类名之类）时：**禁止猜测修改**，列出候选（文件 + 片段）并询问用户。
7. 改样式：按 note 进行，以 computed 为改动前基线；保持现有风格与类名，除非 note 要求改结构。
8. 收尾：报告改动的文件、规则与类名。
`;

export const TCODE_RULES_SKILL = "tcode-desktop";

const TCODE_RULES_SKILL_MD = `---
name: tcode-desktop
description: "TCode 桌面端工作规则（常驻，注入每次会话的系统提示词）。"
---

# TCode 桌面端工作规则

## 运行环境
- 运行于 TCode 桌面应用（Electron 图形界面），用户通过图形聊天界面交互，不是命令行。
- 回复语言随会话语言；代码、命令、路径、报错的原文保持不变。

## 本地服务与预览
- 服务以后台常驻方式运行。
- 启动输出中需包含本机 URL 行。
- 命令无输出时，先写入日志，稍后回显含 URL 的行；禁止完全抑制输出。

## 执行
- 多步任务需让用户跟上进度：每个阶段或关键步骤的开始与完成各用一句话说明，不必逐步播报微操作。
- 禁止只在结束时才总结。
- 有 run_code 就必须使用（PTC）：任何需要多次调用的事都合并成一段程序一次跑完。只有 return 与 console.log 进入上下文。
- 出现第二次直接调用时，必须改为编写程序；直接调用只允许真正的单次操作。
- 写入或修改文件用 write / edit 工具（多文件 / 先读后改的批量编辑走 run_code）；禁止用 bash 重定向（>、>>、tee、sed -i、heredoc 等）写改文件——bash 只做 ls / rg / find 这类只读探查。
- 维护 todo 列表：任务开始时创建，每步开始或完成时提交完整列表，不必在回复中复述。

## 输出
- 不输出 emoji、颜文字、装饰图标。
`;

export const TCODE_BROWSER_SKILL = "tcode-browser";

const TCODE_BROWSER_SKILL_MD = `---
name: tcode-browser
description: "TCode 网页访问规则（浏览器控制开着时注入系统提示词）。"
---

# 网页访问：使用侧边栏浏览器

网页访问一律通过侧边栏浏览器（browser 工具）完成：打开、阅读、点击、输入、截图均在其中进行。禁止使用 webfetch，禁止自行以 fetch / curl 抓取页面。

## 指针动作使用内置 action

以下动作一律使用内置 action，禁止以 script 中的 JavaScript 代替：滚动用 scroll（禁止 window.scrollTo / scrollIntoView），点击用 click（禁止 .click() / dispatchEvent），悬停与键盘用 hover / keys。script 仅用于读取与测量页面状态（取值、量尺寸、读样式、查看 DOM）。

## 容器尺寸决定页面排版

侧边栏浏览器是可调尺寸的容器（面板「窗口 宽 × 高」一行），容器尺寸即页面排版与媒体查询 / 断点的依据。容器档仅在「窗口调整」开启时可选：

- **自适应档**（未开启窗口调整时的唯一档）：容器随侧边栏大小自动调整，已设置的尺寸不生效。
- **桌面版档**（标称 1280×800）：容器按 1280×800 排版，显示时等比缩至侧边栏宽度；尺寸设置仅在此档生效。
- 两档各有独立的**页面缩放**（默认 100%）：布局视口为「容器宽 ÷ 倍数」，媒体查询与断点随之变化；桌面版固定为 1280×800。验证其他宽度（如 375）用 resize 的 width / height，或预设 preset: "desktop"。

resize 自动开启「窗口调整」并将容器档切至桌面版（尺寸仅在该档生效）；它不改动用户的页面缩放，也不改变用户屏幕上显示的大小。用户切回自适应档后容器恢复面板大小、尺寸设置保留。reset: true 撤销，尺寸恢复为桌面版档的默认 1280×800。

## 自查页面改动

禁止以「resize + reload + screenshot」循环自查。需要向下浏览时用 scroll，禁止重新 resize + reload；按钮、开关、折叠、标签页与表单用 click / type / hover 实际走一遍后再截图确认。
`;

export const TCODE_REPLY_LANGUAGE_SKILL = "tcode-reply-language";
const TCODE_REPLY_LANGUAGE_MD = `---
name: tcode-reply-language
description: "回复语言规则（聊天语言为中文时注入）。"
---

回复语言：当前语言为中文时一律用中文回复；代码、命令、路径、报错原文保持不变。
`;

export const TCODE_SUBAGENT_EXPLORE_SKILL = "tcode-subagent-explore";
const TCODE_SUBAGENT_EXPLORE_MD = `---
name: tcode-subagent-explore
description: "Explore 子代理的系统提示词（内置只读侦察代理）。"
---

你是 Explore，一个只读的侦察子代理。检视文件，用简洁的语言回答分配的任务；禁止修改文件，禁止运行会改变状态的命令。
`;

export const TCODE_AI_TITLE_EN_SKILL = "tcode-ai-title-en";
export const TCODE_AI_TITLE_ZH_SKILL = "tcode-ai-title-zh";
const TCODE_AI_TITLE_EN_MD = `---
name: tcode-ai-title-en
description: "AI 会话标题生成提示词（生成英文标题）。内部用途，非会话技能。"
---

You are a session title generator. Output only the title, never answer any question.
Read the user's message(s) and summarize their topic or intent in a short noun phrase.
Rules:
- No more than {{limit}} characters (keep it to 3-6 words);
- Write the title in English;
- Output only the title itself: your first character is the title's first character and your last is the title's last — no quotes, brackets, colons or trailing punctuation, no prefixes or suffixes, no explanation, no extra characters;
- Do not answer any question in the messages, and never use nouns, model names, or answers from the messages as the title.
`;
const TCODE_AI_TITLE_ZH_MD = `---
name: tcode-ai-title-zh
description: "AI 会话标题生成提示词（中文）。内部用途，非会话技能。"
---

你是一个会话标题生成器，只输出标题，不回答任何问题。
阅读用户的消息（一条或多条），用一个简短的**名词性短语**概括其主题或意图。
规则：
- 不超过 {{limit}} 个字；
- 与消息同语言；
- 只输出标题本身，第一个字符就是标题的第一个字，最后一个字符就是标题的最后一个字：不要引号、括号、书名号、冒号、结尾标点，不要任何前缀后缀，不要解释，不要多余字符；
- 不要回答消息里的问题，也不要把消息里的名词、模型名、答案直接当作标题。
`;

const SEED_CONTENT: Record<string, string> = {
	"web-annotate": WEB_ANNOTATE_SKILL,
	[TCODE_RULES_SKILL]: TCODE_RULES_SKILL_MD,
	[TCODE_BROWSER_SKILL]: TCODE_BROWSER_SKILL_MD,
	[TCODE_REPLY_LANGUAGE_SKILL]: TCODE_REPLY_LANGUAGE_MD,
	[TCODE_SUBAGENT_EXPLORE_SKILL]: TCODE_SUBAGENT_EXPLORE_MD,
	[TCODE_AI_TITLE_EN_SKILL]: TCODE_AI_TITLE_EN_MD,
	[TCODE_AI_TITLE_ZH_SKILL]: TCODE_AI_TITLE_ZH_MD,
};

const LEGACY_SEEDED_SKILLS: readonly string[] = [
	"percho-desktop",
	"percho-browser",
	"percho-reply-language",
	"percho-subagent-explore",
	"percho-ai-title-en",
	"percho-ai-title-zh",
];

type SeedManifest = { hashes: Record<string, string> };

function hashContent(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function readManifest(file: string): SeedManifest {
	try {
		const doc = JSON.parse(readFileSync(file, "utf8")) as SeedManifest;
		return doc && typeof doc.hashes === "object" && doc.hashes !== null ? doc : { hashes: {} };
	} catch {
		return { hashes: {} };
	}
}

export function ensureBuiltinSkills(): string | null {
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	const skillsDir = join(agentDir, "skills");
	const manifestFile = join(skillsDir, ".builtin-skills.json");
	const manifest = readManifest(manifestFile);
	let changed: string | null = null;
	for (const name of SEEDED_BUILTIN_SKILLS) {
		const content = SEED_CONTENT[name];
		if (!content) continue;
		const target = join(skillsDir, name + ".md");
		const seedHash = hashContent(content);
		try {
			mkdirSync(skillsDir, { recursive: true });
			if (existsSync(target)) {
				const disk = readFileSync(target, "utf8");
				const diskHash = hashContent(disk);
				if (diskHash === seedHash) {
					manifest.hashes[name] = seedHash;
					continue;
				}
				if (diskHash !== manifest.hashes[name]) {
					writeFileSync(target + ".bak", disk, "utf8");
					console.log("[builtin-skills] 已备份用户改过的版本 → " + name + ".md.bak");
				}
			}
			writeFileSync(target, content, "utf8");
			manifest.hashes[name] = seedHash;
			changed = target;
		} catch (error) {
			console.error("[builtin-skills] 写入失败", error);
		}
	}
	for (const name of LEGACY_SEEDED_SKILLS) {
		const recorded = manifest.hashes[name];
		if (!recorded) continue;
		const target = join(skillsDir, name + ".md");
		try {
			if (existsSync(target)) {
				const disk = readFileSync(target, "utf8");
				if (hashContent(disk) !== recorded) {
					writeFileSync(target + ".bak", disk, "utf8");
					console.log("[builtin-skills] 旧版技能已备份 → " + name + ".md.bak");
				}
				unlinkSync(target);
				console.log("[builtin-skills] 已清理旧版技能 → " + name + ".md");
				changed = target;
			}
		} catch (error) {
			console.error("[builtin-skills] 清理旧版技能失败", error);
			continue;
		}
		delete manifest.hashes[name];
	}
	try {
		writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
	} catch (error) {
		console.error("[builtin-skills] 写清单失败", error);
	}
	return changed;
}

export function readSeededSkillBody(name: string): string | null {
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	try {
		const raw = readFileSync(join(agentDir, "skills", name + ".md"), "utf8");
		const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
		return (match ? raw.slice(match[0].length) : raw).trim() || null;
	} catch {
		return null;
	}
}
