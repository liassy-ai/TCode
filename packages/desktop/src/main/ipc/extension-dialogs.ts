import type { PiBackend } from "@tcode/backend";
import { EXTENSION_DIALOG_CHANNELS } from "@tcode/shared";
import { registerInvokeHandlers } from "./invoke";

export function registerExtensionDialogIpc(backend: PiBackend): void {
	registerInvokeHandlers(EXTENSION_DIALOG_CHANNELS, {
		respondExtensionDialog: ({ requestId, answer }) => backend.respondExtensionDialog(requestId, answer),
	});
}
