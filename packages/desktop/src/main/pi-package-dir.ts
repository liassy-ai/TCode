import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

const dir = join(process.resourcesPath, "pi-package");
if (app.isPackaged && existsSync(dir)) {
	process.env.PI_PACKAGE_DIR = dir;
}
