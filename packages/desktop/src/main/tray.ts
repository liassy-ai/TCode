import { join } from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";

let tray: Tray | null = null;

function trayIconPath(): string {
	return app.isPackaged
		? join(process.resourcesPath, "tray-icon.png")
		: join(import.meta.dirname, "../../build/icon.png");
}

interface TrayHandlers {
	onShow: () => void;
	onQuit: () => void;
}

export function setupTray(handlers: TrayHandlers): void {
	if (tray) return;
	const image = nativeImage.createFromPath(trayIconPath());
	const icon = image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 });
	tray = new Tray(icon);

	const zh = app.getLocale().toLowerCase().startsWith("zh");
	tray.setToolTip("TCode");
	tray.on("click", () => handlers.onShow());
	tray.on("double-click", () => handlers.onShow());
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: zh ? "显示主窗口" : "Show TCode", click: () => handlers.onShow() },
			{ type: "separator" },
			{ label: zh ? "退出 TCode" : "Quit TCode", click: () => handlers.onQuit() },
		]),
	);
}

export function getTray(): Tray | null {
	return tray && !tray.isDestroyed() ? tray : null;
}

export function destroyTray(): void {
	tray?.destroy();
	tray = null;
}
