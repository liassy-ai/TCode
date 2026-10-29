import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectResourceLoader } from "../src/project/trust-loader";
import { SkillPrefsService } from "../src/settings/skill-prefs";
import { slashCommandsForLoader } from "../src/slash-commands";

async function makeHarness() {
	const root = await mkdtemp(join(tmpdir(), "tcode-skill-override-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	await mkdir(cwd, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = agentDir;

	for (const name of ["alpha-skill", "beta-skill"]) {
		const dir = join(agentDir, "skills", name);
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${name} description\n---\n\n# ${name}\n`,
			"utf8",
		);
	}
	const prefs = new SkillPrefsService(join(agentDir, "skill-prefs.json"), agentDir);
	const loader = new ProjectResourceLoader({
		trustStore: new ProjectTrustStore(agentDir),
		ask: async () => undefined,
		canAsk: () => false,
		buildExtensions: () => [],
		projectTrust: false,
		warmSkillPrefs: () => prefs.getDisabledNames("project"),
		getDisabledSkills: () => prefs.getDisabledNamesSync("project"),
	});
	return { loader, prefs, root };
}

describe("skillsOverride（用户关闭模型自动调用）", () => {
	const envBefore = process.env.PI_CODING_AGENT_DIR;
	afterEach(() => {
		if (envBefore === undefined) process.env.PI_CODING_AGENT_DIR = undefined;
		else process.env.PI_CODING_AGENT_DIR = envBefore;
	});

	it("关闭的 skill 置 disableModelInvocation，未关闭的不动；两者都仍在 / 列表", async () => {
		const { loader, prefs, root } = await makeHarness();
		await prefs.setModelInvocationDisabled("beta-skill", true);
		const { resourceLoader } = await loader.load(join(root, "project"));

		const skills = resourceLoader.getSkills().skills;
		expect(skills.map((skill) => [skill.name, skill.disableModelInvocation])).toEqual([
			["alpha-skill", false],
			["beta-skill", true],
		]);

		const names = slashCommandsForLoader(resourceLoader)
			.filter((command) => command.source === "skill")
			.map((command) => command.name);
		expect(names).toEqual(["skill:alpha-skill", "skill:beta-skill"]);
	});

	it("同一 loader 实例 reload 后实时读到新名单（热重载不失效）", async () => {
		const { loader, prefs, root } = await makeHarness();
		await prefs.setModelInvocationDisabled("beta-skill", true);
		const { resourceLoader } = await loader.load(join(root, "project"));
		const disabled = () =>
			resourceLoader.getSkills().skills.find((skill) => skill.name === "beta-skill")?.disableModelInvocation;

		expect(disabled()).toBe(true);

		await prefs.setModelInvocationDisabled("beta-skill", false);
		await resourceLoader.reload();
		expect(disabled()).toBe(false);
	});

	it("frontmatter 已指定 disable-model-invocation 的 skill 保持 true（作者意图优先）", async () => {
		const { loader, prefs, root } = await makeHarness();
		const skillDir = join(process.env.PI_CODING_AGENT_DIR as string, "skills", "gamma-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: gamma-skill\ndescription: manual only\ndisable-model-invocation: true\n---\n\n# gamma\n",
			"utf8",
		);
		const { resourceLoader } = await loader.load(join(root, "project"));
		const gamma = resourceLoader.getSkills().skills.find((skill) => skill.name === "gamma-skill");
		expect(gamma?.disableModelInvocation).toBe(true);
		expect(await prefs.getPrefs()).toEqual({ modelInvocationDisabled: [], modelInvocationEnabled: [] });
	});

	it("内置默认关闭的 skill（tcode-ui-plugin）默认不进系统提示词，开启后 reload 恢复", async () => {
		const { loader, prefs, root } = await makeHarness();
		const skillDir = join(process.env.PI_CODING_AGENT_DIR as string, "skills", "tcode-ui-plugin");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: tcode-ui-plugin\ndescription: builtin default off\n---\n\n# tcode\n",
			"utf8",
		);
		const { resourceLoader } = await loader.load(join(root, "project"));
		const disabled = () =>
			resourceLoader.getSkills().skills.find((skill) => skill.name === "tcode-ui-plugin")
				?.disableModelInvocation;

		expect(disabled()).toBe(true);
		const names = slashCommandsForLoader(resourceLoader)
			.filter((command) => command.source === "skill")
			.map((command) => command.name);
		expect(names).toContain("skill:tcode-ui-plugin");

		await prefs.setModelInvocationDisabled("tcode-ui-plugin", false);
		await resourceLoader.reload();
		expect(disabled()).toBe(false);

		await prefs.setModelInvocationDisabled("tcode-ui-plugin", true);
		await resourceLoader.reload();
		expect(disabled()).toBe(true);
	});
});
