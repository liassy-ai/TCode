import type { PiBackend } from "@tcode/backend";
import { FS_CHANNELS } from "@tcode/shared";
import { readWorkspaceFile } from "../fs-read";
import { registerInvokeHandlers } from "./invoke";

export function registerFsIpc(_backend: PiBackend): void {
	registerInvokeHandlers(FS_CHANNELS, {
		readWorkspaceFile: (request) => readWorkspaceFile(request),
	});
}
