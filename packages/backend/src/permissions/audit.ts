import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 1024 * 1024;
const KEEP_TAIL_BYTES = 512 * 1024;

export interface PermissionAuditEntry {
	t: string;

	sessionId?: string;

	tool: string;

	action: "ask" | "deny";

	text: string;

	cwd?: string;

	boundary?: "outside-write" | "outside-read" | "temporary";
}

export function permissionAuditPath(agentDir: string): string {
	return join(agentDir, "permission-audit.jsonl");
}

export class PermissionAuditLog {
	constructor(private readonly path: string) {}

	record(entry: PermissionAuditEntry): void {
		try {
			appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
			this.truncateIfNeeded();
		} catch {}
	}

	private truncateIfNeeded(): void {
		try {
			const size = statSync(this.path).size;
			if (size <= MAX_BYTES) return;
			const content = readFileSync(this.path, "utf8");
			const tail = content.slice(-KEEP_TAIL_BYTES);

			const clean = tail.slice(tail.indexOf("\n") + 1);
			const tmp = `${this.path}.tmp`;
			writeFileSync(tmp, clean, "utf8");
			renameSync(tmp, this.path);
		} catch {}
	}
}
