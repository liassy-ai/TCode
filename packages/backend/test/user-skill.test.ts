import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUserSkill, deleteUserSkill, SEEDED_BUILTIN_SKILLS } from "../src/settings/user-skills";

describe("createUserSkill（设置页「添加」）", () => {
	const envBefore = process.env.PI_CODING_AGENT_DIR;
	let agentDir: string;

	afterEach(() => {
		if (envBefore === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = envBefore;
	});

	async function makeAgentDir() {
		agentDir = await mkdtemp(join(tmpdir(), "tcode-user-skill-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
	}

	it("写 <agentDir>/skills/<name>/SKILL.md（frontmatter 含 name 与引号描述），无正文写 TODO 占位", async () => {
		await makeAgentDir();
		const file = await createUserSkill({ name: "my-skill", description: "带冒号：的描述" });
		expect(file).toBe(join(agentDir, "skills", "my-skill", "SKILL.md"));
		const text = await readFile(file, "utf8");
		expect(text).toContain("name: my-skill");

		expect(text).toContain(JSON.stringify("带冒号：的描述"));
		expect(text).toContain("TODO:");
	});

	it("带正文时 trim 尾部空白后原样落盘", async () => {
		await makeAgentDir();
		const file = await createUserSkill({
			name: "with-body",
			description: "desc",
			content: "# 步骤\n1. 做\n\n  ",
		});
		const text = await readFile(file, "utf8");
		expect(text.endsWith("# 步骤\n1. 做\n")).toBe(true);
	});

	it("同名目录已存在 → 拒绝", async () => {
		await makeAgentDir();
		await mkdir(join(agentDir, "skills", "dup"), { recursive: true });
		await expect(createUserSkill({ name: "dup", description: "d" })).rejects.toThrow(/exists/);
	});

	it("非法名拒写：穿越/分隔符/空/尾点/保留名；校验前不建任何目录", async () => {
		await makeAgentDir();
		for (const name of ["../evil", "a/b", "", "  ", "trail.", "CON", "nul"]) {
			await expect(createUserSkill({ name, description: "d" })).rejects.toThrow(/invalid skill name/);
		}
		expect(existsSync(join(agentDir, "skills"))).toBe(false);
	});

	it("描述为空 → 拒绝", async () => {
		await makeAgentDir();
		await expect(createUserSkill({ name: "ok-name", description: "  " })).rejects.toThrow(/description/);
	});
});

describe("deleteUserSkill（详情弹窗删除按钮）", () => {
	const envBefore = process.env.PI_CODING_AGENT_DIR;
	let agentDir: string;

	afterEach(() => {
		if (envBefore === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = envBefore;
	});

	async function makeAgentDir() {
		agentDir = await mkdtemp(join(tmpdir(), "tcode-user-skill-del-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
	}

	it("删除 <name>/SKILL.md：文件与空父目录一并移除", async () => {
		await makeAgentDir();
		const file = await createUserSkill({ name: "gone", description: "d" });
		await deleteUserSkill(file);
		expect(existsSync(file)).toBe(false);
		expect(existsSync(join(agentDir, "skills", "gone"))).toBe(false);
	});

	it("删除平铺 .md：只删文件；目录里有其他文件时目录保留", async () => {
		await makeAgentDir();
		await mkdir(join(agentDir, "skills"), { recursive: true });
		const flat = join(agentDir, "skills", "flat.md");
		await writeFile(flat, "---\nname: flat\ndescription: d\n---\n", "utf8");
		const dirSkill = join(agentDir, "skills", "packed", "SKILL.md");
		await mkdir(join(agentDir, "skills", "packed"), { recursive: true });
		await writeFile(dirSkill, "---\nname: packed\ndescription: d\n---\n", "utf8");
		await writeFile(join(agentDir, "skills", "packed", "extra.txt"), "keep me", "utf8");

		await deleteUserSkill(flat);
		expect(existsSync(flat)).toBe(false);

		await deleteUserSkill(dirSkill);
		expect(existsSync(dirSkill)).toBe(false);

		expect(existsSync(join(agentDir, "skills", "packed", "extra.txt"))).toBe(true);
	});

	it("拒绝删除 agent skills 目录之外/非 .md/不存在的文件", async () => {
		await makeAgentDir();
		await mkdir(join(agentDir, "project", ".pi", "skills", "proj-skill"), { recursive: true });
		const outside = join(agentDir, "project", ".pi", "skills", "proj-skill", "SKILL.md");
		await writeFile(outside, "---\nname: proj-skill\ndescription: d\n---\n", "utf8");
		await expect(deleteUserSkill(outside)).rejects.toThrow(/user-level/);

		await expect(deleteUserSkill(join(agentDir, "skills", "whatever.txt"))).rejects.toThrow(/not a markdown/);
		await expect(deleteUserSkill(join(agentDir, "whatever.txt"))).rejects.toThrow(/user-level/);
		await expect(deleteUserSkill(join(agentDir, "skills", "nope.md"))).rejects.toThrow(/not found/);
	});

	it("播种的系统级技能不可删（web-annotate）", async () => {
		await makeAgentDir();
		await mkdir(join(agentDir, "skills"), { recursive: true });
		const seeded = join(agentDir, "skills", "web-annotate.md");
		await writeFile(seeded, "---\nname: web-annotate\ndescription: d\n---\n", "utf8");
		expect(SEEDED_BUILTIN_SKILLS).toContain("web-annotate");
		await expect(deleteUserSkill(seeded)).rejects.toThrow(/built-in/);
		expect(existsSync(seeded)).toBe(true);
	});
});
