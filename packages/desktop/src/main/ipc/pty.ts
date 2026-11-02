import type { PiBackend } from "@tcode/backend";
import { PTY_CHANNELS } from "@tcode/shared";
import type { PtyManager } from "../pty";
import { registerInvokeHandlers } from "./invoke";

export function registerPtyIpc(_backend: PiBackend, manager: PtyManager): void {
	registerInvokeHandlers(PTY_CHANNELS, {
		ptyCreate: (request) => manager.create(request),
		ptyWrite: ({ id, data }) => manager.write(id, data),
		ptyResize: ({ id, cols, rows }) => manager.resize(id, cols, rows),
		ptyKill: ({ id }) => manager.kill(id),
	});
}
