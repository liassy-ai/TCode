import { IpcChannels, isAllowedBrowserUrl } from "@tcode/shared";
import { app, session, shell } from "electron";
import { primeGuest } from "./browser-guest";
import { sendToRenderer } from "./ipc/index";
import { loadUiState } from "./ui-state";

export const BROWSER_PARTITION = "persist:tcode-browser";

export function setupBrowserHardening(): void {
	const guestSession = session.fromPartition(BROWSER_PARTITION);
	guestSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
	guestSession.setPermissionCheckHandler(() => false);

	app.on("web-contents-created", (_event, contents) => {
		if (contents.getType() !== "webview") return;

		void loadUiState()
			.then((state) => {
				if (state?.browserControl === true) primeGuest(contents);
			})
			.catch(() => {});
		contents.setWindowOpenHandler(({ url }) => {
			if (/^https?:\/\//i.test(url)) {
				sendToRenderer(IpcChannels.SidePaneOpenBrowserTab, { url });
			} else {
				void shell.openExternal(url);
			}
			return { action: "deny" };
		});
		contents.on("will-navigate", (event, url) => {
			if (!isAllowedBrowserUrl(url)) event.preventDefault();
		});
	});
}
