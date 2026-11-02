import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { createLogger } from "@tcode/backend";
import { app, type BrowserWindow, dialog } from "electron";

const log = createLogger("background");

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

export function backgroundsDir(): string {
	return join(app.getPath("userData"), "backgrounds");
}

export async function pickBackgroundImage(window: BrowserWindow | undefined): Promise<string | null> {
	const options: Electron.OpenDialogOptions = {
		properties: ["openFile"],
		filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
	};
	const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
	const source = result.canceled ? null : result.filePaths[0];
	if (!source) return null;
	try {
		const dir = backgroundsDir();
		await mkdir(dir, { recursive: true });
		const name = `bg-${Date.now()}${extname(source).toLowerCase()}`;
		await copyFile(source, join(dir, name));
		for (const file of await readdir(dir)) {
			if (file !== name) await rm(join(dir, file), { force: true });
		}
		return name;
	} catch (err) {
		log.error("background pick failed", err);
		return null;
	}
}
