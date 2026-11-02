import { IpcChannels, WEB_ACCESS_CHANNELS } from "@tcode/shared";
import type { WebBridgeService } from "../web-bridge";
import { sendToRenderer } from "./index";
import { registerInvokeHandlers } from "./invoke";

export function registerWebAccessIpc(bridge: WebBridgeService): void {
	registerInvokeHandlers(WEB_ACCESS_CHANNELS, {
		webAccessGetStatus: () => bridge.status(),
		webAccessSetEnabled: async ({ enabled, port }) => {
			if (typeof enabled !== "boolean") throw new Error("webAccessSetEnabled: enabled must be boolean");
			const status = await bridge.setEnabled(enabled, port);

			sendToRenderer(IpcChannels.WebAccessChanged, status);
			return status;
		},
		webAccessSetScope: async ({ scope }) => {
			if (scope !== "local" && scope !== "lan" && scope !== "internet")
				throw new Error("webAccessSetScope: scope must be local|lan|internet");
			const status = await bridge.setScope(scope);
			sendToRenderer(IpcChannels.WebAccessChanged, status);
			return status;
		},
		webAccessRegenerateToken: async () => {
			const status = await bridge.regenerateToken();
			sendToRenderer(IpcChannels.WebAccessChanged, status);
			return status;
		},
	});
}
