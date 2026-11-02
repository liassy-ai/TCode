import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

if (!app.isPackaged) {
	const devUserData = `${app.getPath("userData")}-dev`;
	app.setPath("userData", devUserData);
	mkdirSync(devUserData, { recursive: true });
	console.log(`[dev-agent-dir] userData=${devUserData}（与正式版 userData 隔离）`);
}

if (!app.isPackaged && !process.env.PI_CODING_AGENT_DIR) {
	const devDir = join(homedir(), ".pi", "agent-dev");
	const prodDir = join(homedir(), ".pi", "agent");
	process.env.PI_CODING_AGENT_DIR = devDir;
	mkdirSync(devDir, { recursive: true });

	for (const name of ["auth.json", "models.json", "settings.json", "permissions.json", "trust.json"]) {
		const src = join(prodDir, name);
		const dest = join(devDir, name);
		try {
			if (existsSync(src) && !existsSync(dest)) copyFileSync(src, dest);
		} catch {}
	}
	console.log(`[dev-agent-dir] PI_CODING_AGENT_DIR=${devDir}（与正式 ~/.pi/agent 隔离）`);
}
