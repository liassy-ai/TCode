import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { skillDefaultsOffIn } from "@tcode/shared";
import { describe, expect, it } from "vitest";
import { SkillPrefsService } from "../src/settings/skill-prefs";

async function makeService() {
	const dir = await mkdtemp(join(tmpdir(), "tcode-skill-prefs-"));
	await writeFile(join(dir, "settings.json"), JSON.stringify({ channelWatchEnabled: true }));
	return {
		dir,
		path: join(dir, "skill-prefs.json"),
		service: new SkillPrefsService(join(dir, "skill-prefs.json"), dir),
	};
}

describe("SkillPrefsService", () => {
	it("开关禁用名单：关闭写入、再开启记入 enabled，名单排序去重", async () => {
		const { service } = await makeService();
		expect(await service.getPrefs()).toEqual({ modelInvocationDisabled: [], modelInvocationEnabled: [] });
		await service.setModelInvocationDisabled("design-handoff", true);
		await service.setModelInvocationDisabled("channel-pickup", true);
		expect(await service.getPrefs()).toEqual({
			modelInvocationDisabled: ["channel-pickup", "design-handoff"],
			modelInvocationEnabled: [],
		});
		await service.setModelInvocationDisabled("design-handoff", false);
		expect(await service.getPrefs()).toEqual({
			modelInvocationDisabled: ["channel-pickup"],
			modelInvocationEnabled: ["design-handoff"],
		});
	});

	it("生效禁用集按空间算默认值：日常开、项目关；用户关闭两处都算", async () => {
		const { service } = await makeService();
		await service.setModelInvocationDisabled("scout", true);
		expect(await service.getDisabledNames("daily")).toEqual(new Set(["scout"]));
		expect(await service.getDisabledNames("project")).toEqual(new Set(["tcode-ui-plugin", "scout"]));
	});

	it("空间默认值来源：tcode-ui-plugin 只在项目空间默认关闭（日常默认开）", async () => {
		expect(skillDefaultsOffIn("daily")).not.toContain("tcode-ui-plugin");
		expect(skillDefaultsOffIn("project")).toContain("tcode-ui-plugin");

		const cold = await makeService();
		expect(cold.service.getDisabledNamesSync("project")).toEqual(new Set(["tcode-ui-plugin"]));
		expect(cold.service.getDisabledNamesSync("daily")).toEqual(new Set());
	});

	it("空间默认关闭的技能：用户显式开启后移出生效集，再关回恢复（两处空间都跟用户开关走）", async () => {
		const { service } = await makeService();
		await service.setModelInvocationDisabled("tcode-ui-plugin", false);
		expect(await service.getDisabledNames("daily")).toEqual(new Set());
		expect(await service.getDisabledNames("project")).toEqual(new Set());
		expect(await service.getPrefs()).toEqual({
			modelInvocationDisabled: [],
			modelInvocationEnabled: ["tcode-ui-plugin"],
		});
		await service.setModelInvocationDisabled("tcode-ui-plugin", true);
		expect(await service.getDisabledNames("daily")).toEqual(new Set(["tcode-ui-plugin"]));
		expect(await service.getDisabledNames("project")).toEqual(new Set(["tcode-ui-plugin"]));
		expect(await service.getPrefs()).toEqual({
			modelInvocationDisabled: ["tcode-ui-plugin"],
			modelInvocationEnabled: [],
		});
	});

	it("普通技能不受空间默认值影响：用户开关为准", async () => {
		const { service } = await makeService();
		await service.setModelInvocationDisabled("my-skill", true);
		await service.setModelInvocationDisabled("my-skill", false);
		expect(await service.getDisabledNames("daily")).toEqual(new Set());
		expect(await service.getDisabledNames("project")).toEqual(new Set(["tcode-ui-plugin"]));
		expect(await service.getPrefs()).toEqual({
			modelInvocationDisabled: [],
			modelInvocationEnabled: ["my-skill"],
		});
	});

	it("核心级技能不允许关闭", async () => {
		const { service } = await makeService();
		await expect(service.setModelInvocationDisabled("tcode-desktop", true)).rejects.toThrow(/core skill/);
		await expect(service.setModelInvocationDisabled("web-annotate", true)).rejects.toThrow(/core skill/);
	});

	it("空名单名拒写", async () => {
		const { service } = await makeService();
		await expect(service.setModelInvocationDisabled("  ", true)).rejects.toThrow(/required/);
	});

	it("原子写不遗留临时文件", async () => {
		const { dir, service } = await makeService();
		await service.setModelInvocationDisabled("scout", true);
		expect((await readdir(dir)).sort()).toEqual(["settings.json", "skill-prefs.json"]);
	});

	it("损坏文件安全回退为空名单", async () => {
		const { path, service } = await makeService();
		await writeFile(path, "{broken", "utf8");
		expect(await service.getPrefs()).toEqual({ modelInvocationDisabled: [], modelInvocationEnabled: [] });
	});

	it("旧 json 脏值读侧规整（非字符串丢弃、去重排序；无 enabled 字段兼容）", async () => {
		const { path } = await makeService();
		await writeFile(path, JSON.stringify({ modelInvocationDisabled: ["b", "  ", "a", "b", 42] }), "utf8");
		const fresh = new SkillPrefsService(path, dirname(path));
		expect(await fresh.getPrefs()).toEqual({
			modelInvocationDisabled: ["a", "b"],
			modelInvocationEnabled: [],
		});
	});
});
