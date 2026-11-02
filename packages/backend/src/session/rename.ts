import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export function renameSessionFile(sessionFile: string, name: string): void {
	if (!existsSync(sessionFile)) throw new Error(`Session file not found: ${sessionFile}`);
	SessionManager.open(sessionFile).appendSessionInfo(name);
}
