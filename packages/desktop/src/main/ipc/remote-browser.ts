import { REMOTE_BROWSER_CHANNELS } from "@tcode/shared";
import { probeEmbeddable } from "../embed-probe";
import type { RemoteBrowserManager } from "../remote-browser";
import { registerInvokeHandlers } from "./invoke";

export function registerRemoteBrowserIpc(manager: RemoteBrowserManager): void {
	registerInvokeHandlers(REMOTE_BROWSER_CHANNELS, {
		remoteBrowserCreate: async ({ url, width, height, scale }) => ({
			id: await manager.create(url, width, height, scale),
		}),
		remoteBrowserResize: ({ id, width, height, scale }) => {
			manager.resize(id, width, height, scale);
		},
		remoteBrowserInput: ({ id, event }) => {
			manager.input(id, event);
		},
		remoteBrowserStatus: ({ id }) => manager.status(id),
		remoteBrowserEvaluate: ({ id, code }) => manager.evaluate(id, code),
		remoteBrowserSetActive: ({ id, active }) => {
			manager.setActive(id, active);
		},
		remoteBrowserDestroy: ({ id }) => {
			manager.destroy(id);
		},
		remoteBrowserProbeEmbed: ({ url }) => probeEmbeddable(url),
	});
}
