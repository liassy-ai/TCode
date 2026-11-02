import { lstat, mkdir, readdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@tcode/backend";
import { app } from "electron";
import { copyTree } from "./fs-tree";
import { NAME_RE } from "./manifest";

const log = createLogger("ui-plugins");

export function pluginsDir(): string {
	return join(app.getPath("userData"), "ui-plugins");
}

export function builtinPluginsDir(): string {
	return join(uiPluginsResourcesDir(), "builtin");
}

function builtinSeedStampPath(): string {
	return join(pluginsDir(), ".builtin-seed.json");
}

export async function seedBuiltinPlugins(): Promise<void> {
	const stampPath = builtinSeedStampPath();
	const version = app.getVersion();
	const stamp = await readFile(stampPath, "utf-8")
		.then((s) => JSON.parse(s) as { version?: string })
		.catch(() => null);
	if (app.isPackaged && stamp?.version === version) return;
	const src = builtinPluginsDir();
	const entries = await readdir(src, { withFileTypes: true }).catch(() => []);
	let allOk = true;
	for (const entry of entries) {
		if (!entry.isDirectory() || !NAME_RE.test(entry.name)) continue;
		const ok = await copyTree(join(src, entry.name), join(pluginsDir(), entry.name));
		if (!ok) allOk = false;
	}
	if (!allOk) {
		log.error("builtin plugins seed incomplete, will retry next launch");
		return;
	}
	await writeFile(stampPath, JSON.stringify({ version }), "utf-8").catch((err) =>
		log.error("builtin seed stamp failed", err),
	);
}

export function uiPluginsResourcesDir(): string {
	return app.isPackaged
		? join(process.resourcesPath, "ui-plugins")
		: join(__dirname, "../../resources/ui-plugins");
}

export async function seedDocs(): Promise<void> {
	const root = pluginsDir();
	for (const file of ["SPEC.md", "tcode-ui.d.ts"]) {
		try {
			const [src, dst] = await Promise.all([
				readFile(join(uiPluginsResourcesDir(), file)),
				readFile(join(root, file)).catch(() => null),
			]);
			if (dst && src.equals(dst)) continue;
			await writeFile(join(root, file), src);
		} catch (err) {
			log.error("seed doc failed", file, err);
		}
	}

	await copyTree(join(uiPluginsResourcesDir(), "examples"), join(root, "_examples"));
	const link = join(homedir(), ".tcode", "ui-plugins");
	try {
		const existing = await lstat(link).catch(() => null);
		if (existing?.isSymbolicLink()) {
			if ((await realpath(link)) !== root) {
				log.warn("~/.tcode/ui-plugins symlink 指向其他位置，跳过");
			}
		} else if (existing) {
			log.warn("~/.tcode/ui-plugins 已存在且非 symlink，跳过");
		} else {
			await mkdir(join(homedir(), ".tcode"), { recursive: true });

			await symlink(root, link, process.platform === "win32" ? "junction" : undefined);
		}
	} catch (err) {
		log.error(`symlink ~/.tcode/ui-plugins failed（真实插件目录：${root}）`, err);
	}
}
